import uuid
from typing import Annotated, Optional

import pytest
import opik
from opik.api_objects.agent_config.config import AgentConfig
from opik.api_objects.agent_config.service import AgentConfigService
from opik.rest_api import core as rest_api_core
from opik.rest_api.types.agent_config_env import AgentConfigEnv


def _unique_project_name() -> str:
    return f"e2e-agent-config-{str(uuid.uuid4())[:8]}"


@pytest.fixture
def project_name(opik_client: opik.Opik):
    name = _unique_project_name()
    yield name
    try:
        project_id = opik_client.rest_client.projects.retrieve_project(name=name).id
        opik_client.rest_client.projects.delete_project_by_id(project_id)
    except rest_api_core.ApiError:
        pass


# ---------------------------------------------------------------------------
# create_agent_config / get_agent_config (high-level API)
# ---------------------------------------------------------------------------


class MyConfig(AgentConfig):
    temperature: float = 0.7
    model: str = "gpt-4"
    max_tokens: Optional[int] = None


class MyFallback(AgentConfig):
    temperature: float = 0.5
    model: str = "gpt-3.5"


def test_create_agent_config__and_get__happyflow(
    opik_client: opik.Opik,
    project_name: str,
):
    cfg = MyConfig()
    be_cfg = opik_client.create_agent_config(cfg, project_name=project_name)

    assert isinstance(be_cfg, AgentConfig)
    assert be_cfg.id is not None
    assert be_cfg["temperature"] == 0.7
    assert be_cfg["model"] == "gpt-4"
    assert be_cfg.is_fallback is False

    # Retrieve it back
    fetched = opik_client.get_agent_config(project_name=project_name)
    assert fetched is not None
    assert fetched["temperature"] == 0.7
    assert fetched["model"] == "gpt-4"
    assert fetched.is_fallback is False


def test_create_agent_config__second_call_no_new_fields__returns_existing(
    opik_client: opik.Opik,
    project_name: str,
):
    cfg1 = MyConfig()
    be_cfg1 = opik_client.create_agent_config(cfg1, project_name=project_name)
    first_id = be_cfg1.id

    cfg2 = MyConfig()
    be_cfg2 = opik_client.create_agent_config(cfg2, project_name=project_name)

    # Same blueprint returned, no new version created
    assert be_cfg2.id == first_id


def test_create_agent_config__with_new_fields__creates_new_version(
    opik_client: opik.Opik,
    project_name: str,
):
    cfg = MyConfig()
    be_cfg = opik_client.create_agent_config(cfg, project_name=project_name)
    first_id = be_cfg.id

    class ExtendedConfig(AgentConfig):
        temperature: float = 0.7
        model: str = "gpt-4"
        max_tokens: Optional[int] = None
        use_tools: bool = True

    ext_cfg = ExtendedConfig()
    be_ext = opik_client.create_agent_config(ext_cfg, project_name=project_name)

    assert be_ext.id is not None
    assert be_ext.id != first_id


def test_create_agent_config__optional_none_field__sent_to_backend(
    opik_client: opik.Opik,
    project_name: str,
):
    cfg = MyConfig()
    assert cfg.max_tokens is None

    be_cfg = opik_client.create_agent_config(cfg, project_name=project_name)

    assert "max_tokens" in be_cfg.keys()


def test_create_agent_config__validation__rejects_non_agent_config(
    opik_client: opik.Opik,
):
    with pytest.raises(TypeError, match="must be an instance"):
        opik_client.create_agent_config(config={"temperature": 0.7})


def test_get_agent_config__not_found__returns_none(
    opik_client: opik.Opik,
    project_name: str,
):
    result = opik_client.get_agent_config(project_name=project_name)
    assert result is None


def test_get_agent_config__not_found_with_fallback__returns_fallback(
    opik_client: opik.Opik,
    project_name: str,
):
    fallback = MyFallback()
    result = opik_client.get_agent_config(project_name=project_name, fallback=fallback)

    assert result is fallback
    assert result.is_fallback is True


def test_get_agent_config__with_env(
    opik_client: opik.Opik,
    project_name: str,
):
    service = AgentConfigService(
        project_name=project_name,
        rest_client_=opik_client.rest_client,
    )

    bp = service.create_blueprint(parameters={"temperature": 0.4})
    bp_id = bp.id
    assert bp_id is not None

    # Create another blueprint so latest != the one we want
    service.create_blueprint(parameters={"temperature": 0.9})

    project_id = opik_client.rest_client.projects.retrieve_project(name=project_name).id
    opik_client.rest_client.agent_configs.create_or_update_envs(
        project_id=project_id,
        envs=[AgentConfigEnv(env_name="staging", blueprint_id=bp_id)],
    )

    fetched = opik_client.get_agent_config(env="staging", project_name=project_name)
    assert fetched is not None
    assert fetched.id == bp_id
    assert fetched["temperature"] == 0.4


def test_get_agent_config__with_mask_id(
    opik_client: opik.Opik,
    project_name: str,
):
    cfg = MyConfig()
    be_cfg = opik_client.create_agent_config(cfg, project_name=project_name)

    mask_id = be_cfg.create_mask(
        parameters={"temperature": 0.1},
        description="low-temp",
    )

    masked = opik_client.get_agent_config(project_name=project_name, mask_id=mask_id)
    assert masked is not None
    assert masked["temperature"] == 0.1


def test_get_agent_config__latest_flag(
    opik_client: opik.Opik,
    project_name: str,
):
    service = AgentConfigService(
        project_name=project_name,
        rest_client_=opik_client.rest_client,
    )
    service.create_blueprint(parameters={"temperature": 0.1}, description="v1")
    bp_v2 = service.create_blueprint(parameters={"temperature": 0.9}, description="v2")

    fetched = opik_client.get_agent_config(latest=True, project_name=project_name)
    assert fetched is not None
    assert fetched.id == bp_v2.id
    assert fetched["temperature"] == 0.9


# ---------------------------------------------------------------------------
# AgentConfig instance methods (create_mask, update_env)
# ---------------------------------------------------------------------------


def test_agent_config__create_mask__happyflow(
    opik_client: opik.Opik,
    project_name: str,
):
    cfg = MyConfig()
    be_cfg = opik_client.create_agent_config(cfg, project_name=project_name)

    mask_id = be_cfg.create_mask(
        parameters={"temperature": 0.2},
        description="variant-A",
    )
    assert isinstance(mask_id, str)

    masked = opik_client.get_agent_config(project_name=project_name, mask_id=mask_id)
    assert masked["temperature"] == 0.2


def test_agent_config__update_env__happyflow(
    opik_client: opik.Opik,
    project_name: str,
):
    cfg = MyConfig()
    be_cfg = opik_client.create_agent_config(cfg, project_name=project_name)
    bp_id = be_cfg.id

    be_cfg.update_env(env="staging")

    fetched = opik_client.get_agent_config(env="staging", project_name=project_name)
    assert fetched is not None
    assert fetched.id == bp_id


# ---------------------------------------------------------------------------
# AgentConfigService (lower-level) tests
# ---------------------------------------------------------------------------


def test_service__programmatic_create_and_get__happyflow(
    opik_client: opik.Opik,
    project_name: str,
):
    service = AgentConfigService(
        project_name=project_name,
        rest_client_=opik_client.rest_client,
    )

    bp_v1 = service.create_blueprint(
        parameters={"temperature": 0.5, "max_tokens": 100},
        description="v1",
    )
    assert bp_v1.id is not None
    assert bp_v1["temperature"] == 0.5
    assert bp_v1["max_tokens"] == 100

    bp_v2 = service.create_blueprint(
        parameters={"temperature": 0.8, "max_tokens": 200},
        description="v2",
    )
    assert bp_v2.id is not None
    assert bp_v2.id != bp_v1.id
    assert bp_v2["temperature"] == 0.8
    assert bp_v2["max_tokens"] == 200

    latest = service.get_blueprint()
    assert latest["temperature"] == 0.8
    assert latest["max_tokens"] == 200


def test_service__get_blueprint_by_env_tag__happyflow(
    opik_client: opik.Opik,
    project_name: str,
):
    service = AgentConfigService(
        project_name=project_name,
        rest_client_=opik_client.rest_client,
    )

    bp = service.create_blueprint(parameters={"temperature": 0.4})
    blueprint_id = bp.id
    assert blueprint_id is not None

    # Create another so latest != what we want
    service.create_blueprint(parameters={"temperature": 0.4})

    project_id = opik_client.rest_client.projects.retrieve_project(name=project_name).id
    opik_client.rest_client.agent_configs.create_or_update_envs(
        project_id=project_id,
        envs=[AgentConfigEnv(env_name="prod", blueprint_id=blueprint_id)],
    )

    prod_bp = service.get_blueprint(env="prod")
    assert prod_bp.id == blueprint_id
    assert prod_bp["temperature"] == 0.4


def test_service__mask_creation_and_application__happyflow(
    opik_client: opik.Opik,
    project_name: str,
):
    service = AgentConfigService(
        project_name=project_name,
        rest_client_=opik_client.rest_client,
    )

    base_bp = service.create_blueprint(
        parameters={"temperature": 0.7, "max_tokens": 256, "model": "gpt-4"},
    )

    mask_id = service.create_mask(
        parameters={"temperature": 0.2},
        description="low-temperature variant",
    )

    assert isinstance(mask_id, str)
    assert mask_id != base_bp.id
    assert base_bp["temperature"] == 0.7

    masked = service.get_blueprint(mask_id=mask_id)
    assert masked["temperature"] == 0.2


def test_service__multiple_blueprints_each_produce_new_id__happyflow(
    opik_client: opik.Opik,
    project_name: str,
):
    service = AgentConfigService(
        project_name=project_name,
        rest_client_=opik_client.rest_client,
    )

    bp_v1 = service.create_blueprint(
        parameters={"temperature": 0.1, "max_tokens": 10}, description="v1"
    )
    bp_v2 = service.create_blueprint(
        parameters={"temperature": 0.2, "max_tokens": 20}, description="v2"
    )
    bp_v3 = service.create_blueprint(
        parameters={"temperature": 0.3, "max_tokens": 30}, description="v3"
    )

    assert bp_v1.id != bp_v2.id != bp_v3.id

    latest = service.get_blueprint()
    assert latest.id == bp_v3.id
    assert latest["temperature"] == 0.3


def test_service__multiple_masks__each_distinct__happyflow(
    opik_client: opik.Opik,
    project_name: str,
):
    service = AgentConfigService(
        project_name=project_name,
        rest_client_=opik_client.rest_client,
    )

    service.create_blueprint(parameters={"temperature": 0.7, "model": "gpt-4"})

    mask_id_a = service.create_mask(
        parameters={"temperature": 0.1}, description="low-temp"
    )
    mask_id_b = service.create_mask(
        parameters={"temperature": 0.9}, description="high-temp"
    )

    assert mask_id_a != mask_id_b

    fetched_a = service.get_blueprint(mask_id=mask_id_a)
    fetched_b = service.get_blueprint(mask_id=mask_id_b)

    assert fetched_a.id == fetched_b.id
    assert fetched_a["temperature"] == 0.1
    assert fetched_b["temperature"] == 0.9


def test_service__annotated_descriptions__sent_to_backend(
    opik_client: opik.Opik,
    project_name: str,
):
    class AnnotatedConfig(AgentConfig):
        model: Annotated[str, "The LLM model identifier"] = "gpt-4o"
        temperature: Annotated[float, "Sampling temperature"] = 0.7
        max_tokens: int = 512
        use_tools: Annotated[bool, "Whether to enable tool use"] = True

    cfg = AnnotatedConfig()
    opik_client.create_agent_config(cfg, project_name=project_name)

    service = AgentConfigService(
        project_name=project_name,
        rest_client_=opik_client.rest_client,
    )
    bp = service.get_blueprint()
    assert bp is not None

    raw_values = {v.key: v for v in bp._raw.values}

    assert raw_values["model"].description == "The LLM model identifier"
    assert raw_values["temperature"].description == "Sampling temperature"
    assert raw_values["max_tokens"].description is None
    assert raw_values["use_tools"].description == "Whether to enable tool use"
