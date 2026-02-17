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
- Managing projects and datasets
- General questions about using Opik

Be concise, helpful, and technical when appropriate. If you don't know something specific about Opik, say so.

Each user message begins with a [Current page: ...] tag indicating which page of the Opik UI the user is currently viewing, along with a brief description of that page. Use this context to tailor your responses and provide page-specific guidance. For example, focus on trace-related help when the user is viewing project traces, or dataset-related help when on the datasets page. Do not mention this tag to the user.

You have access to tools that can help you retrieve information about the user's Opik workspace."""


def get_session_id_from_user(user_id: str) -> str:
    """Generate a session ID for the copilot based on user ID.
    
    Args:
        user_id: The user ID
        
    Returns:
        Session ID in format "opik-copilot-{user_id}"
    """
    return f"opik-copilot-{user_id}"


def get_copilot_tools(opik_client: OpikBackendClient) -> list[Callable[..., Any]]:
    """Return the tools for the copilot agent.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        
    Returns:
        List of tool functions wrapped with safe_wrapper
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

    return [safe_wrapper(list_projects)]


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
    opik_metadata: Optional[dict[str, Any]] = None,
) -> Agent:
    """Build an ADK Agent configured for general Opik assistance.
    
    Creates a conversational agent with access to basic Opik operations like
    listing projects. Uses the Opik backend proxy for LLM calls with user authentication.
    
    Args:
        opik_client: Client for fetching data from Opik backend
        current_user: User authentication context (session token + workspace)
        opik_metadata: Optional metadata for internal Opik tracking
        
    Returns:
        Configured ADK Agent
    """
    from .config import settings

    logger.info(
        f"[COPILOT_AGENT] Creating copilot agent for user_id={current_user.user_id}, "
        f"workspace={current_user.workspace_name}"
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

    # Build agent kwargs
    tools = get_copilot_tools(opik_client)
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
