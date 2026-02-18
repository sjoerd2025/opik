"""OpikCopilot agent: product-wide AI assistant for Opik platform.

Provides a conversational agent that can help users with general Opik questions
and perform basic operations like listing projects. Uses user-scoped sessions
(one session per user) rather than resource-scoped sessions.
"""

import time
import uuid
from typing import Any, Callable, Optional

from google.adk.agents import Agent
from google.adk.events import Event, EventActions
from google.adk.models.lite_llm import LiteLlm
from google.adk.runners import Runner
from google.adk.sessions import BaseSessionService, InMemorySessionService

from ._agent import safe_wrapper
from .auth_dependencies import UserContext
from .logger_config import logger
from .opik_backend_client import OpikBackendClient

COPILOT_APP_NAME = "opik-copilot"

COPILOT_SYSTEM_PROMPT = """You are OllieAI, a helpful AI assistant for the Opik platform. Opik is an open-source LLM evaluation and observability platform.

You help users with:
- Understanding their LLM application traces and spans
- Debugging issues in their LLM pipelines
- Optimizing prompts and model configurations
- Analyzing evaluation results
- Managing projects, datasets, prompts, and experiments
- General questions about using Opik

Be concise, helpful, and technical when appropriate. If you don't know something specific about Opik, say so.

## Page Context Awareness

Each user message begins with a [Current page: ...] tag indicating which page of the Opik UI the user is currently viewing, along with a brief description of that page. Use this context to tailor your responses and provide page-specific guidance. Do not mention this tag to the user.

**IMPORTANT**: You have access to tools that are dynamically selected based on the page the user is viewing. When the user asks questions about what they're currently looking at, proactively use the available tools to fetch relevant data. For example:

- **On project traces pages**: Use `get_current_table_view` to fetch the exact filtered/sorted data the user sees, `list_traces` to browse all traces, or `get_trace` to examine a specific trace
- **On datasets pages**: Use `get_current_table_view` to fetch the exact filtered data the user sees, or `list_datasets` to browse all datasets
- **On experiments pages**: Use `get_current_table_view` to fetch the exact filtered/grouped data the user sees (automatically uses the grouped view when the user has grouping enabled), or `list_experiments` to browse all experiments
- **On prompts pages**: Use `list_prompts` to see saved prompts

When the `get_current_table_view` tool is available, prefer it over `list_traces`/`list_datasets`/`list_experiments` when the user asks about what they currently see -- it returns the same data as the table on screen, including any active filters and sorting. Use `list_*` tools when the user wants to browse outside the current view.

When users ask "what do I have here?" or "show me my data" or similar questions about the current page, immediately use the appropriate tools to fetch and present the information. Don't ask for clarification if the page context makes it clear what they want to see.

You have access to tools that can help you retrieve information about the user's Opik workspace. Use them proactively when the user's question relates to the data they're viewing."""


def get_session_id_from_user(user_id: str) -> str:
    """Generate a session ID for the copilot based on user ID.
    
    Args:
        user_id: The user ID
        
    Returns:
        Session ID in format "opik-copilot-{user_id}"
    """
    return f"opik-copilot-{user_id}"


def _make_list_projects(opik_client: OpikBackendClient) -> Callable[..., Any]:
    """Create a list_projects tool.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        
    Returns:
        Tool function for listing projects
    """
    async def list_projects(size: int = 25, page: int = 1) -> dict[str, Any]:
        """List projects in the user's workspace.
        
        Args:
            size: Number of projects to return per page (default: 25)
            page: Page number to return (default: 1)
            
        Returns:
            Dictionary containing projects list and pagination info
        """
        logger.info(f"[COPILOT_TOOL] list_projects called with size={size}, page={page}")
        result = await opik_client.list_projects(size=size, page=page)
        logger.debug(f"[COPILOT_TOOL] list_projects returned {len(result.get('content', []))} projects")
        return result
    
    return list_projects


def _make_get_current_table_view_traces(
    opik_client: OpikBackendClient,
    project_id: str,
    table_state: dict[str, Any],
) -> Callable[..., Any]:
    """Create a get_current_table_view tool for the traces table.

    The table state (filters, sorting, pagination) is captured in the closure so
    the LLM cannot hallucinate parameters -- this tool takes no arguments.
    """
    async def get_current_table_view() -> dict[str, Any]:
        """Get the traces currently visible in the user's table, respecting their
        active filters, sorting, and pagination. Returns the same data the user sees."""
        logger.info(f"[COPILOT_TOOL] get_current_table_view (traces) called for project={project_id}")
        result = await opik_client.list_traces(
            project_id=project_id,
            size=table_state.get("size", 25),
            page=table_state.get("page", 1),
            filters=table_state.get("filters"),
            sorting=table_state.get("sorting"),
            search=table_state.get("search"),
        )
        logger.debug(f"[COPILOT_TOOL] get_current_table_view (traces) returned {len(result.get('content', []))} traces")
        return result

    return get_current_table_view


def _make_get_current_table_view_datasets(
    opik_client: OpikBackendClient,
    table_state: dict[str, Any],
) -> Callable[..., Any]:
    """Create a get_current_table_view tool for the datasets table."""
    async def get_current_table_view() -> dict[str, Any]:
        """Get the datasets currently visible in the user's table, respecting their
        active filters, sorting, and pagination. Returns the same data the user sees."""
        logger.info("[COPILOT_TOOL] get_current_table_view (datasets) called")
        result = await opik_client.list_datasets(
            size=table_state.get("size", 25),
            page=table_state.get("page", 1),
            filters=table_state.get("filters"),
            sorting=table_state.get("sorting"),
            search=table_state.get("search"),
        )
        logger.debug(f"[COPILOT_TOOL] get_current_table_view (datasets) returned {len(result.get('content', []))} datasets")
        return result

    return get_current_table_view


def _make_get_current_table_view_experiments(
    opik_client: OpikBackendClient,
    table_state: dict[str, Any],
) -> Callable[..., Any]:
    """Create a get_current_table_view tool for the experiments table."""
    async def get_current_table_view() -> dict[str, Any]:
        """Get the experiments currently visible in the user's table, respecting their
        active filters, sorting, grouping, and pagination. Returns the same data the user sees.
        When experiments are grouped (e.g. by dataset or project), returns the grouped structure."""
        groups = table_state.get("groups")
        if groups:
            logger.info("[COPILOT_TOOL] get_current_table_view (experiments/groups) called")
            result = await opik_client.list_experiment_groups(
                groups=groups,
                filters=table_state.get("filters"),
                search=table_state.get("search"),
            )
            logger.debug(f"[COPILOT_TOOL] get_current_table_view (experiments/groups) returned {len(result.get('content', {}))} groups")
        else:
            logger.info("[COPILOT_TOOL] get_current_table_view (experiments) called")
            result = await opik_client.list_experiments(
                size=table_state.get("size", 25),
                page=table_state.get("page", 1),
                filters=table_state.get("filters"),
                sorting=table_state.get("sorting"),
                search=table_state.get("search"),
            )
            logger.debug(f"[COPILOT_TOOL] get_current_table_view (experiments) returned {len(result.get('content', []))} experiments")
        return result

    return get_current_table_view


def _make_get_current_table_view_spans(
    opik_client: OpikBackendClient,
    project_id: str,
    table_state: dict[str, Any],
) -> Callable[..., Any]:
    """Create a get_current_table_view tool for the spans table."""
    async def get_current_table_view() -> dict[str, Any]:
        """Get the spans currently visible in the user's table, respecting their
        active filters, sorting, and pagination. Returns the same data the user sees."""
        logger.info(f"[COPILOT_TOOL] get_current_table_view (spans) called for project={project_id}")
        result = await opik_client.list_spans(
            project_id=project_id,
            size=table_state.get("size", 25),
            page=table_state.get("page", 1),
            filters=table_state.get("filters"),
            sorting=table_state.get("sorting"),
            search=table_state.get("search"),
        )
        logger.debug(f"[COPILOT_TOOL] get_current_table_view (spans) returned {len(result.get('content', []))} spans")
        return result

    return get_current_table_view


def _make_get_current_table_view_threads(
    opik_client: OpikBackendClient,
    project_id: str,
    table_state: dict[str, Any],
) -> Callable[..., Any]:
    """Create a get_current_table_view tool for the threads table."""
    async def get_current_table_view() -> dict[str, Any]:
        """Get the threads currently visible in the user's table, respecting their
        active filters, sorting, and pagination. Returns the same data the user sees."""
        logger.info(f"[COPILOT_TOOL] get_current_table_view (threads) called for project={project_id}")
        result = await opik_client.list_threads(
            project_id=project_id,
            size=table_state.get("size", 25),
            page=table_state.get("page", 1),
            filters=table_state.get("filters"),
            sorting=table_state.get("sorting"),
            search=table_state.get("search"),
        )
        logger.debug(f"[COPILOT_TOOL] get_current_table_view (threads) returned {len(result.get('content', []))} threads")
        return result

    return get_current_table_view


def _make_get_current_table_view_prompts(
    opik_client: OpikBackendClient,
    table_state: dict[str, Any],
) -> Callable[..., Any]:
    """Create a get_current_table_view tool for the prompts table."""
    async def get_current_table_view() -> dict[str, Any]:
        """Get the prompts currently visible in the user's table, respecting their
        active filters, sorting, and pagination. Returns the same data the user sees."""
        logger.info("[COPILOT_TOOL] get_current_table_view (prompts) called")
        result = await opik_client.list_prompts(
            size=table_state.get("size", 25),
            page=table_state.get("page", 1),
            filters=table_state.get("filters"),
            sorting=table_state.get("sorting"),
            search=table_state.get("search"),
        )
        logger.debug(f"[COPILOT_TOOL] get_current_table_view (prompts) returned {len(result.get('content', []))} prompts")
        return result

    return get_current_table_view


def _make_list_traces(opik_client: OpikBackendClient, project_id: str) -> Callable[..., Any]:
    """Create a list_traces tool for a specific project.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        project_id: The project ID to list traces for
        
    Returns:
        Tool function for listing traces
    """
    async def list_traces(size: int = 25, page: int = 1) -> dict[str, Any]:
        """List traces in the current project.
        
        Args:
            size: Number of traces to return per page (default: 25)
            page: Page number to return (default: 1)
            
        Returns:
            Dictionary containing traces list and pagination info
        """
        logger.info(f"[COPILOT_TOOL] list_traces called for project={project_id}, size={size}, page={page}")
        result = await opik_client.list_traces(project_id=project_id, size=size, page=page)
        logger.debug(f"[COPILOT_TOOL] list_traces returned {len(result.get('content', []))} traces")
        return result
    
    return list_traces


def _make_get_trace(opik_client: OpikBackendClient) -> Callable[..., Any]:
    """Create a get_trace tool.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        
    Returns:
        Tool function for getting a trace by ID
    """
    async def get_trace(trace_id: str) -> dict[str, Any]:
        """Get detailed information about a specific trace.
        
        Args:
            trace_id: The trace ID to retrieve
            
        Returns:
            Dictionary containing trace details
        """
        logger.info(f"[COPILOT_TOOL] get_trace called for trace_id={trace_id}")
        result = await opik_client.get_trace(trace_id)
        logger.debug(f"[COPILOT_TOOL] get_trace returned trace with name={result.get('name')}")
        return result
    
    return get_trace


def _make_list_datasets(opik_client: OpikBackendClient) -> Callable[..., Any]:
    """Create a list_datasets tool.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        
    Returns:
        Tool function for listing datasets
    """
    async def list_datasets(size: int = 25, page: int = 1) -> dict[str, Any]:
        """List datasets in the user's workspace.
        
        Args:
            size: Number of datasets to return per page (default: 25)
            page: Page number to return (default: 1)
            
        Returns:
            Dictionary containing datasets list and pagination info
        """
        logger.info(f"[COPILOT_TOOL] list_datasets called with size={size}, page={page}")
        result = await opik_client.list_datasets(size=size, page=page)
        logger.debug(f"[COPILOT_TOOL] list_datasets returned {len(result.get('content', []))} datasets")
        return result
    
    return list_datasets


def _make_list_dataset_items(opik_client: OpikBackendClient, dataset_id: str) -> Callable[..., Any]:
    """Create a list_dataset_items tool for a specific dataset.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        dataset_id: The dataset ID to list items for
        
    Returns:
        Tool function for listing dataset items
    """
    async def list_dataset_items(size: int = 25, page: int = 1) -> dict[str, Any]:
        """List items in the current dataset.
        
        Args:
            size: Number of items to return per page (default: 25)
            page: Page number to return (default: 1)
            
        Returns:
            Dictionary containing dataset items list and pagination info
        """
        logger.info(f"[COPILOT_TOOL] list_dataset_items called for dataset={dataset_id}, size={size}, page={page}")
        result = await opik_client.list_dataset_items(dataset_id=dataset_id, size=size, page=page)
        logger.debug(f"[COPILOT_TOOL] list_dataset_items returned {len(result.get('content', []))} items")
        return result
    
    return list_dataset_items


def _make_list_prompts(opik_client: OpikBackendClient) -> Callable[..., Any]:
    """Create a list_prompts tool.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        
    Returns:
        Tool function for listing prompts
    """
    async def list_prompts(size: int = 25, page: int = 1) -> dict[str, Any]:
        """List prompts in the user's workspace.
        
        Args:
            size: Number of prompts to return per page (default: 25)
            page: Page number to return (default: 1)
            
        Returns:
            Dictionary containing prompts list and pagination info
        """
        logger.info(f"[COPILOT_TOOL] list_prompts called with size={size}, page={page}")
        result = await opik_client.list_prompts(size=size, page=page)
        logger.debug(f"[COPILOT_TOOL] list_prompts returned {len(result.get('content', []))} prompts")
        return result
    
    return list_prompts


def _make_list_experiments(opik_client: OpikBackendClient) -> Callable[..., Any]:
    """Create a list_experiments tool.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        
    Returns:
        Tool function for listing experiments
    """
    async def list_experiments(size: int = 25, page: int = 1) -> dict[str, Any]:
        """List experiments in the user's workspace.
        
        Args:
            size: Number of experiments to return per page (default: 25)
            page: Page number to return (default: 1)
            
        Returns:
            Dictionary containing experiments list and pagination info
        """
        logger.info(f"[COPILOT_TOOL] list_experiments called with size={size}, page={page}")
        result = await opik_client.list_experiments(size=size, page=page)
        logger.debug(f"[COPILOT_TOOL] list_experiments returned {len(result.get('content', []))} experiments")
        return result
    
    return list_experiments


def get_copilot_tools(
    opik_client: OpikBackendClient,
    page_id: str,
    page_params: dict[str, str],
    table_state: Optional[dict[str, Any]] = None,
) -> list[Callable[..., Any]]:
    """Return the tools for the copilot agent based on the current page context.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        page_id: The current page ID (e.g., "project_traces_table", "datasets")
        page_params: Dictionary of page parameters (e.g., {"projectId": "...", "datasetId": "..."})
        table_state: Optional table state (filters, sorting, page, size, search) from the frontend
        
    Returns:
        List of tool functions wrapped with safe_wrapper
    """
    tools = []
    
    logger.info(f"[COPILOT_TOOLS] Building tools for page_id={page_id}, params={page_params}, has_table_state={table_state is not None}")
    
    # Always available: list projects
    tools.append(_make_list_projects(opik_client))
    
    # Project-related pages: add trace/span/thread tools
    if page_id in ("project_traces_table", "project_spans_table", "project_threads_table", "project_metrics"):
        project_id = page_params.get("projectId")
        if project_id:
            logger.debug(f"[COPILOT_TOOLS] Adding project tools for project {project_id}, page={page_id}")
            if table_state and page_id == "project_traces_table":
                tools.append(_make_get_current_table_view_traces(opik_client, project_id, table_state))
            if table_state and page_id == "project_spans_table":
                tools.append(_make_get_current_table_view_spans(opik_client, project_id, table_state))
            if table_state and page_id == "project_threads_table":
                tools.append(_make_get_current_table_view_threads(opik_client, project_id, table_state))
            tools.append(_make_list_traces(opik_client, project_id))
            tools.append(_make_get_trace(opik_client))
    
    # Dataset-related pages: add dataset tools
    if page_id in ("datasets", "dataset_detail", "dataset_items"):
        logger.debug("[COPILOT_TOOLS] Adding dataset list tool")
        if table_state and page_id == "datasets":
            tools.append(_make_get_current_table_view_datasets(opik_client, table_state))
        tools.append(_make_list_datasets(opik_client))
        dataset_id = page_params.get("datasetId")
        if dataset_id:
            logger.debug(f"[COPILOT_TOOLS] Adding dataset items tool for dataset {dataset_id}")
            tools.append(_make_list_dataset_items(opik_client, dataset_id))
    
    # Prompt-related pages: add prompt tools
    if page_id in ("prompts", "prompt_detail"):
        logger.debug("[COPILOT_TOOLS] Adding prompts list tool")
        if table_state and page_id == "prompts":
            tools.append(_make_get_current_table_view_prompts(opik_client, table_state))
        tools.append(_make_list_prompts(opik_client))
    
    # Experiment-related pages: add experiment tools
    if page_id in ("experiments", "compare_experiments"):
        logger.debug("[COPILOT_TOOLS] Adding experiments list tool")
        if table_state and page_id == "experiments":
            tools.append(_make_get_current_table_view_experiments(opik_client, table_state))
        tools.append(_make_list_experiments(opik_client))
    
    logger.info(f"[COPILOT_TOOLS] Built {len(tools)} tools for page {page_id}")
    
    return [safe_wrapper(tool) for tool in tools]


async def create_copilot_session(
    user_id: str,
    session_service: Optional[BaseSessionService] = None,
    session_id: Optional[str] = None,
) -> tuple[BaseSessionService, str, Any]:
    """Create (or reuse) a session for the copilot agent.
    
    Initializes the session and returns the session service, session ID, and session object.
    
    Args:
        user_id: The user ID
        session_service: Optional session service to use (defaults to InMemorySessionService)
        session_id: Optional session ID (defaults to generated ID from user_id)
        
    Returns:
        Tuple of (session_service, session_id, session)
    """
    if session_id is None:
        session_id = get_session_id_from_user(user_id)

    logger.info(f"[COPILOT_SESSION] Creating session for user_id={user_id}, session_id={session_id}")

    if session_service is None:
        session_service = InMemorySessionService()
        logger.debug("[COPILOT_SESSION] Using InMemorySessionService")

    session = await session_service.create_session(
        app_name=COPILOT_APP_NAME, user_id=user_id, session_id=session_id
    )
    logger.debug(f"[COPILOT_SESSION] Session created successfully")

    # Create a system event to initialize the session
    system_event = Event(
        invocation_id="session_setup",
        author="system",
        actions=EventActions(state_delta={}),
        timestamp=time.time(),
    )

    await session_service.append_event(session, system_event)
    logger.debug("[COPILOT_SESSION] System event appended to session")

    return session_service, session_id, session


def get_copilot_runner(agent: Agent, session_service: BaseSessionService) -> Runner:
    """Create a Runner that executes the copilot agent using the provided session service.
    
    Args:
        agent: The copilot agent to run
        session_service: Session service for managing conversation state
        
    Returns:
        Runner instance
    """
    return Runner(agent=agent, app_name=COPILOT_APP_NAME, session_service=session_service)


async def get_copilot_agent(
    opik_client: OpikBackendClient,
    current_user: UserContext,
    page_id: str,
    page_params: dict[str, str],
    table_state: Optional[dict[str, Any]] = None,
    opik_metadata: Optional[dict[str, Any]] = None,
) -> Agent:
    """Build an ADK Agent configured for general Opik assistance.
    
    Creates a conversational agent with access to page-specific Opik operations.
    Uses the Opik backend proxy for LLM calls with user authentication.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        current_user: User authentication context (session token + workspace)
        page_id: The current page ID (e.g., "project_traces_table", "datasets")
        page_params: Dictionary of page parameters (e.g., {"projectId": "...", "datasetId": "..."})
        opik_metadata: Optional metadata for internal Opik tracking
        
    Returns:
        Configured ADK Agent
    """
    from .config import settings

    logger.info(
        f"[COPILOT_AGENT] Creating copilot agent for user_id={current_user.user_id}, "
        f"workspace={current_user.workspace_name}, page_id={page_id}"
    )

    # Ensure metadata exists
    if opik_metadata is None:
        opik_metadata = {}

    # Only create OpikTracer if internal logging is configured
    tracker = None
    if settings.opik_internal_url:
        from opik.integrations.adk import OpikTracer

        tracker = OpikTracer(metadata=opik_metadata)
        logger.debug("[COPILOT_AGENT] OpikTracer enabled for internal logging")
    else:
        logger.debug("[COPILOT_AGENT] OpikTracer disabled (no internal URL configured)")

    model_name = settings.agent_model
    logger.info(f"[COPILOT_AGENT] Using model: {model_name}")

    # Configure model with optional reasoning_effort
    model_kwargs = {}
    if settings.agent_reasoning_effort:
        model_kwargs["reasoning_effort"] = settings.agent_reasoning_effort
        logger.debug(f"[COPILOT_AGENT] Reasoning effort: {settings.agent_reasoning_effort}")

    # Forward user's auth credentials to the Opik AI proxy
    extra_headers = {}
    if current_user.workspace_name:
        extra_headers["Comet-Workspace"] = current_user.workspace_name
    if current_user.session_token:
        extra_headers["Cookie"] = f"sessionToken={current_user.session_token}"

    logger.debug(f"[COPILOT_AGENT] Extra headers configured: {list(extra_headers.keys())}")

    # Point LiteLLM at the Opik backend's ChatCompletions proxy
    proxy_base_url = f"{settings.agent_opik_url}/v1/private"
    logger.info(
        f"[COPILOT_AGENT] Configuring LiteLLM with proxy: model={model_name}, "
        f"api_base={proxy_base_url}, workspace={current_user.workspace_name}, "
        f"has_session_token={current_user.session_token is not None}"
    )

    import litellm

    litellm.disable_aiohttp_transport = True
    logger.debug("[COPILOT_AGENT] LiteLLM aiohttp transport disabled")

    llm_model = LiteLlm(
        model_name,
        api_base=proxy_base_url,
        api_key="not-checked",
        extra_headers=extra_headers,
        **model_kwargs,
    )
    logger.debug("[COPILOT_AGENT] LiteLLM model configured")

    # Build agent kwargs with page-specific tools
    tools = get_copilot_tools(opik_client, page_id, page_params, table_state=table_state)
    logger.info(f"[COPILOT_AGENT] Configured {len(tools)} tools: {[t.__name__ for t in tools]}")
    
    agent_kwargs = {
        "name": "opik_copilot",
        "model": llm_model,
        "description": (
            "OllieAI is a helpful AI assistant for the Opik platform. "
            "It helps users understand and work with their LLM applications, "
            "providing guidance on traces, evaluations, prompts, and general platform usage."
        ),
        "instruction": COPILOT_SYSTEM_PROMPT,
        "tools": tools,
    }

    # Add OpikTracer callbacks only if internal logging is configured
    if tracker is not None:
        agent_kwargs.update(
            {
                "before_agent_callback": tracker.before_agent_callback,
                "after_agent_callback": tracker.after_agent_callback,
                "before_model_callback": tracker.before_model_callback,
                "after_model_callback": tracker.after_model_callback,
                "before_tool_callback": tracker.before_tool_callback,
                "after_tool_callback": tracker.after_tool_callback,
            }
        )
        logger.debug("[COPILOT_AGENT] OpikTracer callbacks attached")

    copilot_agent = Agent(**agent_kwargs)
    logger.info("[COPILOT_AGENT] Agent created successfully")
    return copilot_agent
