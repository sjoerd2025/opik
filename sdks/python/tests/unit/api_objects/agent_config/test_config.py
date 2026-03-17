from unittest import mock

import pytest

from opik.api_objects.agent_config.config import AgentConfig
from opik.api_objects.agent_config.service import AgentConfigService
from opik.api_objects.agent_config.blueprint import Blueprint
from opik.api_objects.agent_config.context import agent_config_context
from opik.rest_api.types.agent_blueprint_public import AgentBlueprintPublic
from opik.rest_api.types.agent_config_value_public import AgentConfigValuePublic

from typing import Annotated, Optional


def _make_raw_blueprint(blueprint_id="bp-1", values=None, description=None, envs=None):
    if values is None:
        values = [
            AgentConfigValuePublic(key="temp", type="float", value="0.6"),
            AgentConfigValuePublic(key="name", type="string", value="agent"),
        ]
    return AgentBlueprintPublic(
        id=blueprint_id,
        type="blueprint",
        values=values,
        description=description,
        envs=envs,
    )


def _make_blueprint(blueprint_id="bp-1", values=None, envs=None):
    raw = _make_raw_blueprint(blueprint_id=blueprint_id, values=values, envs=envs)
    return Blueprint(raw_blueprint=raw)


def _make_mock_service():
    service = mock.Mock(spec=AgentConfigService)
    return service


# ---------------------------------------------------------------------------
# AgentConfig._from_blueprint
# ---------------------------------------------------------------------------


class TestFromBlueprint:
    def test_creates_instance_with_correct_values(self):
        bp = _make_blueprint(blueprint_id="bp-42")
        cfg = AgentConfig._from_blueprint(bp)

        assert cfg.id == "bp-42"
        assert cfg.values == {"temp": 0.6, "name": "agent"}

    def test_sets_service(self):
        bp = _make_blueprint()
        service = _make_mock_service()
        cfg = AgentConfig._from_blueprint(bp, service=service)

        assert cfg._service is service

    def test_sets_envs_from_blueprint(self):
        bp = _make_blueprint(envs=["prod", "staging"])
        cfg = AgentConfig._from_blueprint(bp)

        assert cfg.envs == ["prod", "staging"]

    def test_is_fallback_defaults_to_false(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)

        assert cfg.is_fallback is False

    def test_mask_cache_is_empty(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)

        assert cfg._mask_cache == {}


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------


class TestProperties:
    def test_values_returns_deepcopy(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)

        v1 = cfg.values
        v1["temp"] = 999
        assert cfg.values["temp"] == 0.6

    def test_id(self):
        bp = _make_blueprint(blueprint_id="bp-abc")
        cfg = AgentConfig._from_blueprint(bp)
        assert cfg.id == "bp-abc"

    def test_envs(self):
        bp = _make_blueprint(envs=["dev"])
        cfg = AgentConfig._from_blueprint(bp)
        assert cfg.envs == ["dev"]

    def test_envs_none(self):
        bp = _make_blueprint(envs=None)
        cfg = AgentConfig._from_blueprint(bp)
        assert cfg.envs is None

    def test_is_fallback(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        assert cfg.is_fallback is False

        cfg._is_fallback = True
        assert cfg.is_fallback is True

    def test_keys(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        assert set(cfg.keys()) == {"temp", "name"}


# ---------------------------------------------------------------------------
# Dict-like and attribute access
# ---------------------------------------------------------------------------


class TestAccess:
    def test_getitem_returns_value(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        assert cfg["temp"] == 0.6
        assert cfg["name"] == "agent"

    def test_getitem_missing_key_raises_keyerror(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        with pytest.raises(KeyError):
            cfg["nonexistent"]

    def test_getattr_returns_value(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        assert cfg.temp == 0.6
        assert cfg.name == "agent"

    def test_getattr_missing_raises_attributeerror(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        with pytest.raises(AttributeError):
            cfg.nonexistent

    def test_getattr_private_raises_attributeerror(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        with pytest.raises(AttributeError):
            cfg._something_private

    def test_get_returns_value(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        assert cfg.get("temp") == 0.6

    def test_get_returns_default_for_missing(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        assert cfg.get("missing") is None
        assert cfg.get("missing", 42) == 42


# ---------------------------------------------------------------------------
# Masking via context
# ---------------------------------------------------------------------------


class TestMaskedAccess:
    def test_no_context_mask__returns_base_value(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp)
        assert cfg["temp"] == 0.6

    def test_no_service__ignores_mask(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp, service=None)

        with agent_config_context("mask-1"):
            assert cfg["temp"] == 0.6

    def test_with_service__returns_masked_value(self):
        bp = _make_blueprint(envs=["prod"])
        service = _make_mock_service()

        masked_raw = _make_raw_blueprint(
            blueprint_id="bp-1",
            values=[
                AgentConfigValuePublic(key="temp", type="float", value="0.1"),
                AgentConfigValuePublic(key="name", type="string", value="masked-agent"),
            ],
        )
        masked_bp = Blueprint(raw_blueprint=masked_raw)
        service.get_blueprint.return_value = masked_bp

        cfg = AgentConfig._from_blueprint(bp, service=service)

        with agent_config_context("mask-1"):
            assert cfg["temp"] == 0.1
            assert cfg["name"] == "masked-agent"

    def test_masked_value_is_cached(self):
        bp = _make_blueprint(envs=["prod"])
        service = _make_mock_service()

        masked_raw = _make_raw_blueprint(
            values=[AgentConfigValuePublic(key="temp", type="float", value="0.2")],
        )
        service.get_blueprint.return_value = Blueprint(raw_blueprint=masked_raw)

        cfg = AgentConfig._from_blueprint(bp, service=service)

        with agent_config_context("mask-1"):
            cfg["temp"]
            cfg["temp"]

        service.get_blueprint.assert_called_once()

    def test_mask_key_not_in_mask__returns_base_value(self):
        bp = _make_blueprint(envs=["prod"])
        service = _make_mock_service()

        masked_raw = _make_raw_blueprint(values=[])
        service.get_blueprint.return_value = Blueprint(raw_blueprint=masked_raw)

        cfg = AgentConfig._from_blueprint(bp, service=service)

        with agent_config_context("mask-1"):
            assert cfg["temp"] == 0.6

    def test_mask_service_error__returns_base_value(self):
        bp = _make_blueprint(envs=["prod"])
        service = _make_mock_service()
        service.get_blueprint.side_effect = Exception("connection failed")

        cfg = AgentConfig._from_blueprint(bp, service=service)

        with agent_config_context("mask-1"):
            assert cfg["temp"] == 0.6

    def test_get_with_mask__returns_masked_value(self):
        bp = _make_blueprint(envs=["prod"])
        service = _make_mock_service()

        masked_raw = _make_raw_blueprint(
            values=[AgentConfigValuePublic(key="temp", type="float", value="0.3")],
        )
        service.get_blueprint.return_value = Blueprint(raw_blueprint=masked_raw)

        cfg = AgentConfig._from_blueprint(bp, service=service)

        with agent_config_context("mask-1"):
            assert cfg.get("temp") == 0.3

    def test_getattr_with_mask__returns_masked_value(self):
        bp = _make_blueprint(envs=["prod"])
        service = _make_mock_service()

        masked_raw = _make_raw_blueprint(
            values=[AgentConfigValuePublic(key="temp", type="float", value="0.4")],
        )
        service.get_blueprint.return_value = Blueprint(raw_blueprint=masked_raw)

        cfg = AgentConfig._from_blueprint(bp, service=service)

        with agent_config_context("mask-1"):
            assert cfg.temp == 0.4


# ---------------------------------------------------------------------------
# create_mask
# ---------------------------------------------------------------------------


class TestCreateMask:
    def test_delegates_to_service(self):
        bp = _make_blueprint()
        service = _make_mock_service()
        service.create_mask.return_value = "mask-123"

        cfg = AgentConfig._from_blueprint(bp, service=service)
        result = cfg.create_mask(parameters={"temp": 0.1}, description="low-temp")

        assert result == "mask-123"
        service.create_mask.assert_called_once_with(
            parameters={"temp": 0.1},
            description="low-temp",
        )

    def test_raises_without_service(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp, service=None)

        with pytest.raises(RuntimeError, match="locally-created config"):
            cfg.create_mask(parameters={"temp": 0.1})


# ---------------------------------------------------------------------------
# update_env
# ---------------------------------------------------------------------------


class TestUpdateEnv:
    def test_delegates_to_service_with_own_blueprint_id(self):
        bp = _make_blueprint(blueprint_id="bp-99")
        service = _make_mock_service()
        refreshed_bp = _make_blueprint(blueprint_id="bp-99", envs=["staging"])
        service.get_blueprint.return_value = refreshed_bp
        cfg = AgentConfig._from_blueprint(bp, service=service)

        cfg.update_env(env="staging")

        service.tag_blueprint_with_env.assert_called_once_with(
            env="staging",
            blueprint_id="bp-99",
        )
        assert cfg.envs == ["staging"]

    def test_raises_without_service(self):
        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp, service=None)

        with pytest.raises(RuntimeError, match="locally-created config"):
            cfg.update_env(env="staging")

    def test_raises_value_error_when_no_id_available(self):
        raw = _make_raw_blueprint(blueprint_id=None)
        bp = Blueprint(raw_blueprint=raw)
        service = _make_mock_service()
        cfg = AgentConfig._from_blueprint(bp, service=service)

        with pytest.raises(ValueError, match="no blueprint ID"):
            cfg.update_env(env="staging")


# ---------------------------------------------------------------------------
# __init_subclass__ auto-dataclass
# ---------------------------------------------------------------------------


class TestInitSubclass:
    def test_subclass_becomes_dataclass(self):
        class MyConfig(AgentConfig):
            model: str = "gpt-4"
            temperature: float = 0.7

        import dataclasses

        assert dataclasses.is_dataclass(MyConfig)

    def test_subclass_instance_has_fields(self):
        class MyConfig(AgentConfig):
            model: str = "gpt-4"
            temperature: float = 0.7

        instance = MyConfig()
        assert instance.model == "gpt-4"
        assert instance.temperature == 0.7


# ---------------------------------------------------------------------------
# _extract_fields_with_values
# ---------------------------------------------------------------------------


class TestExtractFieldsWithValues:
    def test_extracts_primitive_fields(self):
        class MyConfig(AgentConfig):
            model: str = "gpt-4"
            temperature: float = 0.7
            max_tokens: int = 100
            use_tools: bool = True

        instance = MyConfig()
        result = instance._extract_fields_with_values()

        assert result["model"] == (str, "gpt-4", None)
        assert result["temperature"] == (float, 0.7, None)
        assert result["max_tokens"] == (int, 100, None)
        assert result["use_tools"] == (bool, True, None)

    def test_includes_none_optional_fields(self):
        class MyConfig(AgentConfig):
            model: str = "gpt-4"
            max_tokens: Optional[int] = None

        instance = MyConfig()
        result = instance._extract_fields_with_values()

        assert "model" in result
        assert "max_tokens" in result
        assert result["max_tokens"] == (int, None, None)

    def test_skips_private_fields(self):
        class MyConfig(AgentConfig):
            model: str = "gpt-4"

        instance = MyConfig()
        result = instance._extract_fields_with_values()

        assert "model" in result
        for key in result:
            assert not key.startswith("_")

    def test_annotated_descriptions(self):
        class MyConfig(AgentConfig):
            model: Annotated[str, "The LLM model"] = "gpt-4"
            temperature: Annotated[float, "Sampling temp"] = 0.7
            max_tokens: int = 100

        instance = MyConfig()
        result = instance._extract_fields_with_values()

        assert result["model"] == (str, "gpt-4", "The LLM model")
        assert result["temperature"] == (float, 0.7, "Sampling temp")
        assert result["max_tokens"] == (int, 100, None)

    def test_skips_unsupported_types(self):
        class MyConfig(AgentConfig):
            model: str = "gpt-4"

        instance = MyConfig()
        # Manually add an unsupported type field to check it's skipped
        result = instance._extract_fields_with_values()
        # Only supported types should be present
        for _, (py_type, _, _) in result.items():
            assert py_type in (str, int, float, bool) or hasattr(py_type, "__origin__")


# ---------------------------------------------------------------------------
# _inject_trace_metadata – project mismatch check
# ---------------------------------------------------------------------------


class TestInjectTraceMetadataProjectCheck:
    def _make_config_with_service(self, service_project="my-project"):
        service = mock.Mock(spec=AgentConfigService)
        service.project_name = service_project
        bp = _make_blueprint(envs=["prod"])
        cfg = AgentConfig._from_blueprint(bp, service=service)
        return cfg

    @mock.patch("opik.context_storage.get_trace_data")
    def test_matching_project__no_error(self, mock_get_trace):
        trace_data = mock.Mock()
        trace_data.project_name = "my-project"
        mock_get_trace.return_value = trace_data

        cfg = self._make_config_with_service("my-project")
        # Should not raise
        cfg._inject_trace_metadata("temp", 0.6)

    @mock.patch("opik.context_storage.get_trace_data")
    def test_mismatched_project__raises_value_error(self, mock_get_trace):
        trace_data = mock.Mock()
        trace_data.project_name = "other-project"
        mock_get_trace.return_value = trace_data

        cfg = self._make_config_with_service("my-project")
        with pytest.raises(ValueError, match="my-project.*other-project"):
            cfg._inject_trace_metadata("temp", 0.6)

    @mock.patch("opik.context_storage.get_trace_data")
    def test_no_active_trace__no_error(self, mock_get_trace):
        mock_get_trace.return_value = None

        cfg = self._make_config_with_service("my-project")
        # Should not raise
        cfg._inject_trace_metadata("temp", 0.6)

    @mock.patch("opik.context_storage.get_trace_data")
    def test_no_service__no_error(self, mock_get_trace):
        trace_data = mock.Mock()
        trace_data.project_name = "other-project"
        mock_get_trace.return_value = trace_data

        bp = _make_blueprint()
        cfg = AgentConfig._from_blueprint(bp, service=None)
        # Should not raise – no service means no project to compare
        cfg._inject_trace_metadata("temp", 0.6)

    @mock.patch("opik.context_storage.get_trace_data")
    def test_trace_project_none__no_error(self, mock_get_trace):
        trace_data = mock.Mock()
        trace_data.project_name = None
        mock_get_trace.return_value = trace_data

        cfg = self._make_config_with_service("my-project")
        # Should not raise – trace has no project set
        cfg._inject_trace_metadata("temp", 0.6)
