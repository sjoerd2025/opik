from unittest import mock

import pytest

from opik.api_objects.agent_config.config import AgentConfig
from opik.api_objects.agent_config.service import AgentConfigService
from opik.api_objects.agent_config.blueprint import Blueprint
from opik.api_objects import constants
from opik.rest_api import core as rest_api_core
from opik.rest_api.types.agent_blueprint_public import AgentBlueprintPublic
from opik.rest_api.types.agent_config_value_public import AgentConfigValuePublic


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


@pytest.fixture
def mock_rest_client():
    client = mock.Mock()
    client.agent_configs = mock.Mock()
    client.agent_configs.create_agent_config.return_value = None
    client.agent_configs.get_latest_blueprint.return_value = _make_raw_blueprint()
    client.projects.retrieve_project.return_value = mock.Mock(id="proj-default")
    return client


@pytest.fixture
def service(mock_rest_client):
    return AgentConfigService(
        project_name="my-project",
        rest_client_=mock_rest_client,
    )


# ---------------------------------------------------------------------------
# Properties
# ---------------------------------------------------------------------------


class TestServiceProperties:
    def test_project_name(self, service):
        assert service.project_name == "my-project"


# ---------------------------------------------------------------------------
# get_blueprint
# ---------------------------------------------------------------------------


class TestGetBlueprint:
    def test_returns_blueprint(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.return_value = (
            _make_raw_blueprint()
        )

        result = service.get_blueprint()

        assert isinstance(result, Blueprint)
        assert result.id == "bp-1"

    def test_with_env__routes_to_get_blueprint_by_env(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_blueprint_by_env.return_value = (
            _make_raw_blueprint()
        )

        service.get_blueprint(env="prod")

        mock_rest_client.agent_configs.get_blueprint_by_env.assert_called_once_with(
            env_name="prod",
            project_id="proj-1",
            mask_id=None,
        )
        mock_rest_client.agent_configs.get_latest_blueprint.assert_not_called()

    def test_with_mask_id__passes_mask_id(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.return_value = (
            _make_raw_blueprint()
        )

        service.get_blueprint(mask_id="mask-1")

        mock_rest_client.agent_configs.get_latest_blueprint.assert_called_once_with(
            project_id="proj-1",
            mask_id="mask-1",
        )

    def test_with_field_types__resolves_values(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.return_value = (
            _make_raw_blueprint()
        )

        result = service.get_blueprint(field_types={"temp": float, "name": str})

        assert result["temp"] == 0.6
        assert result["name"] == "agent"

    def test_without_field_types__infers_types(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.return_value = (
            _make_raw_blueprint()
        )

        result = service.get_blueprint()

        assert result["temp"] == 0.6
        assert isinstance(result["temp"], float)
        assert result["name"] == "agent"
        assert isinstance(result["name"], str)

    def test_not_found__returns_none(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.side_effect = (
            rest_api_core.ApiError(status_code=404, body="not found")
        )

        result = service.get_blueprint()
        assert result is None

    @pytest.mark.parametrize("mask_id", ["mask-1", "mask-2", None])
    def test_mask_id_passed_to_backend(self, service, mock_rest_client, mask_id):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.return_value = (
            _make_raw_blueprint()
        )

        service.get_blueprint(mask_id=mask_id)

        mock_rest_client.agent_configs.get_latest_blueprint.assert_called_once_with(
            project_id="proj-1",
            mask_id=mask_id,
        )

    def test_env_with_mask_id(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_blueprint_by_env.return_value = (
            _make_raw_blueprint()
        )

        service.get_blueprint(env="prod", mask_id="mask-1")

        mock_rest_client.agent_configs.get_blueprint_by_env.assert_called_once_with(
            env_name="prod",
            project_id="proj-1",
            mask_id="mask-1",
        )


# ---------------------------------------------------------------------------
# get_blueprint by ID
# ---------------------------------------------------------------------------


class TestGetBlueprintById:
    def test_returns_blueprint(self, service, mock_rest_client):
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint(blueprint_id="bp-specific")
        )

        result = service.get_blueprint(id="bp-specific")

        assert isinstance(result, Blueprint)
        assert result.id == "bp-specific"
        mock_rest_client.agent_configs.get_blueprint_by_id.assert_called_once_with(
            "bp-specific", mask_id=None
        )

    def test_not_found__returns_none(self, service, mock_rest_client):
        mock_rest_client.agent_configs.get_blueprint_by_id.side_effect = (
            rest_api_core.ApiError(status_code=404, body="not found")
        )

        result = service.get_blueprint(id="nonexistent")
        assert result is None


# ---------------------------------------------------------------------------
# create_blueprint
# ---------------------------------------------------------------------------


class TestCreateBlueprint:
    def test_happy_path(self, service, mock_rest_client):
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint(blueprint_id="bp-new")
        )

        result = service.create_blueprint(
            fields_with_values={
                "temperature": (float, 0.6, None),
                "name": (str, "agent", None),
            }
        )

        mock_rest_client.agent_configs.create_agent_config.assert_called_once()
        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        blueprint = call_kwargs["blueprint"]
        assert blueprint.type == "blueprint"
        assert blueprint.values is not None
        assert isinstance(result, Blueprint)

    def test_bool_field_serialized_as_boolean(self, service, mock_rest_client):
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint()
        )

        service.create_blueprint(fields_with_values={"flag": (bool, False, None)})

        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        flag_param = [v for v in call_kwargs["blueprint"].values if v.key == "flag"][0]
        assert flag_param.type == "boolean"
        assert flag_param.value == "false"

    def test_passes_project_name(self, service, mock_rest_client):
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint()
        )

        service.create_blueprint(fields_with_values={"temp": (float, 0.5, None)})

        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        assert call_kwargs["project_name"] == "my-project"

    def test_with_parameters(self, service, mock_rest_client):
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint(blueprint_id="bp-new")
        )

        result = service.create_blueprint(parameters={"temp": 0.6, "name": "agent"})

        assert isinstance(result, Blueprint)
        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        keys = {v.key for v in call_kwargs["blueprint"].values}
        assert "temp" in keys
        assert "name" in keys

    def test_with_description(self, service, mock_rest_client):
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint()
        )

        service.create_blueprint(parameters={"temp": 0.6}, description="v1")

        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        assert call_kwargs["blueprint"].description == "v1"

    def test_none_value_in_fields_with_values__passes_none_value(
        self, service, mock_rest_client
    ):
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint()
        )

        service.create_blueprint(
            fields_with_values={"temp": (float, 0.6, None), "name": (str, None, None)}
        )

        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        values_by_key = {v.key: v for v in call_kwargs["blueprint"].values}
        assert "temp" in values_by_key
        assert "name" in values_by_key
        assert values_by_key["name"].value is None

    def test_none_parameter__excluded_from_payload(self, service, mock_rest_client):
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint()
        )

        service.create_blueprint(parameters={"temp": 0.6, "name": None})

        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        keys = {v.key for v in call_kwargs["blueprint"].values}
        assert "temp" in keys
        assert "name" not in keys


# ---------------------------------------------------------------------------
# create_mask
# ---------------------------------------------------------------------------


class TestCreateMask:
    def test_calls_backend_with_mask_type(self, service, mock_rest_client):
        service.create_mask(fields_with_values={"temperature": (float, 0.3, None)})

        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        assert call_kwargs["blueprint"].type == "mask"

    def test_returns_mask_id(self, service, mock_rest_client):
        result = service.create_mask(
            fields_with_values={"temperature": (float, 0.3, None)}
        )
        assert isinstance(result, str)

    def test_with_parameters(self, service, mock_rest_client):
        result = service.create_mask(parameters={"temp": 0.3})
        assert isinstance(result, str)

    def test_with_description(self, service, mock_rest_client):
        service.create_mask(
            fields_with_values={"temperature": (float, 0.3, None)},
            description="variant-A",
        )

        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        assert call_kwargs["blueprint"].description == "variant-A"


# ---------------------------------------------------------------------------
# _resolve_fields_with_values
# ---------------------------------------------------------------------------


class TestResolveFieldsWithValues:
    def test_none_values_excluded(self):
        result = AgentConfigService._resolve_fields_with_values(
            parameters={"temp": 0.5, "name": None},
            fields_with_values=None,
        )
        assert "name" not in result
        assert result["temp"] == (float, 0.5, None)

    def test_all_none_returns_empty(self):
        result = AgentConfigService._resolve_fields_with_values(
            parameters={"a": None, "b": None},
            fields_with_values=None,
        )
        assert result == {}

    def test_fields_with_values_takes_precedence(self):
        explicit = {"x": (int, 1, None)}
        result = AgentConfigService._resolve_fields_with_values(
            parameters={"x": 99},
            fields_with_values=explicit,
        )
        assert result is explicit


# ---------------------------------------------------------------------------
# create_or_update_blueprint
# ---------------------------------------------------------------------------


class TestCreateOrUpdateBlueprint:
    def _make_config_instance(self, fields):
        """Create a mock config with _extract_fields_with_values returning fields."""
        config = mock.Mock(spec=AgentConfig)
        config._extract_fields_with_values.return_value = fields
        return config

    def test_first_creation__creates_blueprint_and_tags_env(
        self, service, mock_rest_client
    ):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.side_effect = (
            rest_api_core.ApiError(status_code=404, body="not found")
        )
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint(blueprint_id="bp-new")
        )

        config = self._make_config_instance(
            {
                "temp": (float, 0.7, None),
                "model": (str, "gpt-4", None),
            }
        )

        result = service.create_or_update_blueprint(config=config)

        assert isinstance(result, Blueprint)
        mock_rest_client.agent_configs.create_agent_config.assert_called_once()
        mock_rest_client.agent_configs.create_or_update_envs.assert_called_once()
        env_call = mock_rest_client.agent_configs.create_or_update_envs.call_args[1]
        assert env_call["envs"][0].env_name == constants.DEFAULT_AGENT_CONFIG_ENV

    def test_existing_no_new_fields__warns_and_returns_existing(
        self, service, mock_rest_client
    ):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.return_value = (
            _make_raw_blueprint(
                blueprint_id="bp-existing",
                values=[
                    AgentConfigValuePublic(key="temp", type="float", value="0.7"),
                    AgentConfigValuePublic(key="model", type="string", value="gpt-4"),
                ],
            )
        )

        config = self._make_config_instance(
            {
                "temp": (float, 0.7, None),
                "model": (str, "gpt-4", None),
            }
        )

        result = service.create_or_update_blueprint(config=config)

        assert result.id == "bp-existing"
        mock_rest_client.agent_configs.create_agent_config.assert_not_called()
        mock_rest_client.agent_configs.create_or_update_envs.assert_not_called()

    def test_existing_with_new_fields__creates_version_with_only_new_fields(
        self, service, mock_rest_client
    ):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.return_value = (
            _make_raw_blueprint(
                blueprint_id="bp-existing",
                values=[
                    AgentConfigValuePublic(key="temp", type="float", value="0.7"),
                ],
            )
        )
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint(blueprint_id="bp-v2")
        )

        config = self._make_config_instance(
            {
                "temp": (float, 0.7, None),
                "model": (str, "gpt-4", None),
                "max_tokens": (int, 100, None),
            }
        )

        result = service.create_or_update_blueprint(config=config)

        assert isinstance(result, Blueprint)
        mock_rest_client.agent_configs.create_agent_config.assert_called_once()

        call_kwargs = mock_rest_client.agent_configs.create_agent_config.call_args[1]
        sent_keys = {v.key for v in call_kwargs["blueprint"].values}
        assert sent_keys == {"model", "max_tokens"}
        assert "temp" not in sent_keys

        # Should NOT tag with env on update
        mock_rest_client.agent_configs.create_or_update_envs.assert_not_called()

    def test_first_creation_no_tag_when_blueprint_id_is_none(
        self, service, mock_rest_client
    ):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.side_effect = (
            rest_api_core.ApiError(status_code=404, body="not found")
        )
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint(blueprint_id=None)
        )

        config = self._make_config_instance({"temp": (float, 0.7, None)})
        service.create_or_update_blueprint(config=config)

        mock_rest_client.agent_configs.create_or_update_envs.assert_not_called()


# ---------------------------------------------------------------------------
# resolve_blueprint
# ---------------------------------------------------------------------------


class TestResolveBlueprint:
    def test_defaults_to_prod_env(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_blueprint_by_env.return_value = (
            _make_raw_blueprint()
        )

        service.resolve_blueprint()

        mock_rest_client.agent_configs.get_blueprint_by_env.assert_called_once_with(
            env_name=constants.DEFAULT_AGENT_CONFIG_ENV,
            project_id="proj-1",
            mask_id=None,
        )

    def test_latest_flag__gets_latest_blueprint(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.return_value = (
            _make_raw_blueprint()
        )

        service.resolve_blueprint(latest=True)

        mock_rest_client.agent_configs.get_latest_blueprint.assert_called_once_with(
            project_id="proj-1",
            mask_id=None,
        )

    def test_with_env__uses_env(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_blueprint_by_env.return_value = (
            _make_raw_blueprint()
        )

        service.resolve_blueprint(env="staging")

        mock_rest_client.agent_configs.get_blueprint_by_env.assert_called_once_with(
            env_name="staging",
            project_id="proj-1",
            mask_id=None,
        )

    def test_with_id__uses_id(self, service, mock_rest_client):
        mock_rest_client.agent_configs.get_blueprint_by_id.return_value = (
            _make_raw_blueprint(blueprint_id="bp-specific")
        )

        result = service.resolve_blueprint(id="bp-specific")

        assert result.id == "bp-specific"
        mock_rest_client.agent_configs.get_blueprint_by_id.assert_called_once_with(
            "bp-specific", mask_id=None
        )

    def test_with_mask_id__passes_mask(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_blueprint_by_env.return_value = (
            _make_raw_blueprint()
        )

        service.resolve_blueprint(mask_id="mask-1")

        mock_rest_client.agent_configs.get_blueprint_by_env.assert_called_once_with(
            env_name=constants.DEFAULT_AGENT_CONFIG_ENV,
            project_id="proj-1",
            mask_id="mask-1",
        )

    def test_latest_with_mask_id(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_latest_blueprint.return_value = (
            _make_raw_blueprint()
        )

        service.resolve_blueprint(latest=True, mask_id="mask-2")

        mock_rest_client.agent_configs.get_latest_blueprint.assert_called_once_with(
            project_id="proj-1",
            mask_id="mask-2",
        )

    def test_not_found__returns_none(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")
        mock_rest_client.agent_configs.get_blueprint_by_env.side_effect = (
            rest_api_core.ApiError(status_code=404, body="not found")
        )

        result = service.resolve_blueprint()
        assert result is None

    def test_with_version__raises_not_implemented(self, service):
        with pytest.raises(NotImplementedError):
            service.resolve_blueprint(version="v1")


# ---------------------------------------------------------------------------
# tag_blueprint_with_env
# ---------------------------------------------------------------------------


class TestTagBlueprintWithEnv:
    def test_calls_backend(self, service, mock_rest_client):
        mock_rest_client.projects.retrieve_project.return_value = mock.Mock(id="proj-1")

        service.tag_blueprint_with_env(env="staging", blueprint_id="bp-123")

        mock_rest_client.agent_configs.create_or_update_envs.assert_called_once()
        call_kwargs = mock_rest_client.agent_configs.create_or_update_envs.call_args[1]
        assert call_kwargs["project_id"] == "proj-1"
        assert call_kwargs["envs"][0].env_name == "staging"
        assert call_kwargs["envs"][0].blueprint_id == "bp-123"
