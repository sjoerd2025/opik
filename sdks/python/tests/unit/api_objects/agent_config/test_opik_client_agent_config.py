from unittest import mock

import pytest

from opik.api_objects.agent_config.config import AgentConfig
from opik.api_objects.agent_config.blueprint import Blueprint
from opik.api_objects.agent_config.service import AgentConfigService
from opik.api_objects import constants
from opik.rest_api.types.agent_blueprint_public import AgentBlueprintPublic
from opik.rest_api.types.agent_config_value_public import AgentConfigValuePublic


def _make_raw_blueprint(blueprint_id="bp-1", values=None, envs=None):
    if values is None:
        values = [
            AgentConfigValuePublic(key="temp", type="float", value="0.7"),
            AgentConfigValuePublic(key="model", type="string", value="gpt-4"),
        ]
    return AgentBlueprintPublic(
        id=blueprint_id, type="blueprint", values=values, envs=envs,
    )


def _make_blueprint(blueprint_id="bp-1", values=None, envs=None):
    raw = _make_raw_blueprint(blueprint_id=blueprint_id, values=values, envs=envs)
    return Blueprint(raw_blueprint=raw)


class MyConfig(AgentConfig):
    temperature: float = 0.7
    model: str = "gpt-4"


class MyFallback(AgentConfig):
    temperature: float = 0.5
    model: str = "gpt-3.5"


# ---------------------------------------------------------------------------
# _validate_agent_config
# ---------------------------------------------------------------------------


class TestValidateAgentConfig:
    def test_valid_config_passes(self):
        from opik.api_objects.opik_client import Opik

        cfg = MyConfig()
        # Should not raise
        Opik._validate_agent_config(cfg)

    def test_invalid_config_raises_type_error(self):
        from opik.api_objects.opik_client import Opik

        with pytest.raises(TypeError, match="must be an instance"):
            Opik._validate_agent_config("not a config")

    def test_invalid_config_dict_raises_type_error(self):
        from opik.api_objects.opik_client import Opik

        with pytest.raises(TypeError, match="must be an instance"):
            Opik._validate_agent_config({"temperature": 0.7})

    def test_custom_param_name_in_error(self):
        from opik.api_objects.opik_client import Opik

        with pytest.raises(TypeError, match="fallback must be an instance"):
            Opik._validate_agent_config("bad", param_name="fallback")


# ---------------------------------------------------------------------------
# create_agent_config
# ---------------------------------------------------------------------------


class TestCreateAgentConfig:
    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_happy_path__returns_agent_config(
        self, mock_httpx, mock_configurator, MockService
    ):
        bp = _make_blueprint(blueprint_id="bp-created")
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.create_or_update_blueprint.return_value = bp
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "test-project"
        client._rest_client = mock.Mock()

        cfg = MyConfig()
        result = Opik.create_agent_config(client, config=cfg)

        assert isinstance(result, AgentConfig)
        assert result.id == "bp-created"
        assert result.values == {"temp": 0.7, "model": "gpt-4"}
        mock_service_instance.create_or_update_blueprint.assert_called_once_with(
            config=cfg,
            description=None,
        )

    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_with_custom_project_name(
        self, mock_httpx, mock_configurator, MockService
    ):
        bp = _make_blueprint()
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.create_or_update_blueprint.return_value = bp
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "default-project"
        client._rest_client = mock.Mock()

        cfg = MyConfig()
        Opik.create_agent_config(client, config=cfg, project_name="custom-project")

        MockService.assert_called_once_with(
            project_name="custom-project",
            rest_client_=client._rest_client,
        )

    def test_invalid_config_raises_type_error(self):
        from opik.api_objects.opik_client import Opik

        with pytest.raises(TypeError, match="must be an instance"):
            Opik._validate_agent_config("not_a_config")


# ---------------------------------------------------------------------------
# get_agent_config
# ---------------------------------------------------------------------------


class TestGetAgentConfig:
    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_happy_path__returns_agent_config(
        self, mock_httpx, mock_configurator, MockService
    ):
        bp = _make_blueprint(blueprint_id="bp-fetched", envs=["prod"])
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.resolve_blueprint.return_value = bp
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "test-project"
        client._rest_client = mock.Mock()

        result = Opik.get_agent_config(client)

        assert isinstance(result, AgentConfig)
        assert result.id == "bp-fetched"
        assert result.is_fallback is False

    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_not_found_no_fallback__returns_none(
        self, mock_httpx, mock_configurator, MockService
    ):
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.resolve_blueprint.return_value = None
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "test-project"
        client._rest_client = mock.Mock()

        result = Opik.get_agent_config(client)
        assert result is None

    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_not_found_with_fallback__returns_fallback_with_is_fallback(
        self, mock_httpx, mock_configurator, MockService
    ):
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.resolve_blueprint.return_value = None
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "test-project"
        client._rest_client = mock.Mock()

        fallback = MyFallback()
        result = Opik.get_agent_config(client, fallback=fallback)

        assert result is fallback
        assert result._is_fallback is True

    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_backend_error_with_fallback__returns_fallback(
        self, mock_httpx, mock_configurator, MockService
    ):
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.resolve_blueprint.side_effect = ConnectionError("offline")
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "test-project"
        client._rest_client = mock.Mock()

        fallback = MyFallback()
        result = Opik.get_agent_config(client, fallback=fallback)

        assert result is fallback
        assert result._is_fallback is True

    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_backend_error_no_fallback__raises(
        self, mock_httpx, mock_configurator, MockService
    ):
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.resolve_blueprint.side_effect = ConnectionError("offline")
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "test-project"
        client._rest_client = mock.Mock()

        with pytest.raises(ConnectionError):
            Opik.get_agent_config(client)

    def test_invalid_fallback_raises_type_error(self):
        from opik.api_objects.opik_client import Opik

        with pytest.raises(TypeError, match="fallback must be an instance"):
            Opik._validate_agent_config("not_a_config", param_name="fallback")

    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_passes_all_parameters_to_resolve(
        self, mock_httpx, mock_configurator, MockService
    ):
        bp = _make_blueprint()
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.resolve_blueprint.return_value = bp
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "test-project"
        client._rest_client = mock.Mock()

        Opik.get_agent_config(
            client,
            version="v1",
            env="staging",
            id="bp-123",
            mask_id="mask-1",
            latest=True,
        )

        mock_service_instance.resolve_blueprint.assert_called_once_with(
            version="v1",
            env="staging",
            id="bp-123",
            mask_id="mask-1",
            latest=True,
        )

    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_with_custom_project_name(
        self, mock_httpx, mock_configurator, MockService
    ):
        bp = _make_blueprint()
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.resolve_blueprint.return_value = bp
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "default-project"
        client._rest_client = mock.Mock()

        Opik.get_agent_config(client, project_name="custom-project")

        MockService.assert_called_once_with(
            project_name="custom-project",
            rest_client_=client._rest_client,
        )

    @mock.patch("opik.api_objects.opik_client.AgentConfigService")
    @mock.patch("opik.api_objects.opik_client.rest_client_configurator")
    @mock.patch("opik.api_objects.opik_client.httpx_client")
    def test_result_has_service_attached(
        self, mock_httpx, mock_configurator, MockService
    ):
        bp = _make_blueprint()
        mock_service_instance = mock.Mock(spec=AgentConfigService)
        mock_service_instance.resolve_blueprint.return_value = bp
        MockService.return_value = mock_service_instance

        from opik.api_objects.opik_client import Opik

        client = mock.Mock(spec=Opik)
        client._project_name = "test-project"
        client._rest_client = mock.Mock()

        result = Opik.get_agent_config(client)

        assert result._service is mock_service_instance
