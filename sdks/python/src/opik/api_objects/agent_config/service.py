import logging
import typing

from opik.rest_api import client as rest_client
from opik.rest_api import core as rest_api_core
from opik.rest_api.types.agent_blueprint_write import AgentBlueprintWrite
from opik.rest_api.types.agent_config_value_write import AgentConfigValueWrite
from opik.rest_api.types.agent_config_env import AgentConfigEnv
from opik.api_objects import rest_helpers
from opik import id_helpers
from .blueprint import Blueprint
from . import type_helpers
from opik.api_objects import constants

logger = logging.getLogger(__name__)


class AgentConfigService:
    """Internal service managing the collection of blueprints for a project."""

    def __init__(
        self,
        project_name: str,
        rest_client_: rest_client.OpikApi,
    ) -> None:
        self._project_name = project_name
        self._rest_client = rest_client_

    @property
    def project_name(self) -> str:
        return self._project_name

    @staticmethod
    def _resolve_fields_with_values(
        parameters: typing.Optional[typing.Dict[str, typing.Any]],
        fields_with_values: typing.Optional[
            typing.Dict[str, typing.Tuple[typing.Any, typing.Any, typing.Optional[str]]]
        ],
    ) -> typing.Dict[str, typing.Tuple[typing.Any, typing.Any, typing.Optional[str]]]:
        if fields_with_values is not None:
            return fields_with_values
        # None values have no runtime type to infer, and python_type_to_backend_type
        # raises TypeError on NoneType, so exclude them here.
        return {
            k: (type(v), v, None)
            for k, v in (parameters or {}).items()
            if v is not None
        }

    def _build_blueprint_payload(
        self,
        fields_with_values: typing.Dict[
            str, typing.Tuple[typing.Any, typing.Any, typing.Optional[str]]
        ],
        description: typing.Optional[str],
        id: typing.Optional[str] = None,
        config_type: str = "blueprint",
    ) -> AgentBlueprintWrite:
        backend_values = []
        for field_name, (py_type, value, field_desc) in fields_with_values.items():
            backend_values.append(
                AgentConfigValueWrite(
                    key=field_name,
                    type=type_helpers.python_type_to_backend_type(py_type),
                    value=type_helpers.python_value_to_backend_value(value, py_type)
                    if value is not None
                    else None,
                    description=field_desc,
                )
            )
        return AgentBlueprintWrite(
            id=id,
            type=config_type,
            values=backend_values,
            description=description,
        )

    def get_blueprint(
        self,
        *,
        id: typing.Optional[str] = None,
        env: typing.Optional[str] = None,
        version: typing.Optional[str] = None,
        mask_id: typing.Optional[str] = None,
        field_types: typing.Optional[typing.Dict[str, typing.Any]] = None,
    ) -> typing.Optional[Blueprint]:
        """Fetch a blueprint by ID, version, environment name, or latest.

        Priority: ``id`` > ``version`` > ``env`` > latest.
        Returns ``None`` if not found.

        Args:
            id: Fetch the blueprint with this exact ID.
            version: Fetch the blueprint by version name (e.g. ``"v1"``).
            env: Fetch the blueprint tagged with this environment name.
            mask_id: ID of a mask blueprint to overlay on the result.
            field_types: Mapping of prefixed field key to Python type used
                for deserialising backend values.
        """
        try:
            if id is not None:
                raw = self._rest_client.agent_configs.get_blueprint_by_id(
                    id, mask_id=mask_id
                )
            elif version is not None:
                # ALEX
                # TODO: replace with a dedicated backend call when available
                raise NotImplementedError(
                    "Fetching blueprints by version is not yet supported"
                )
            else:
                project_id = rest_helpers.resolve_project_id_by_name(
                    self._rest_client, self._project_name
                )
                if env is not None:
                    raw = self._rest_client.agent_configs.get_blueprint_by_env(
                        env_name=env,
                        project_id=project_id,
                        mask_id=mask_id,
                    )
                else:
                    raw = self._rest_client.agent_configs.get_latest_blueprint(
                        project_id=project_id,
                        mask_id=mask_id,
                    )
        except rest_api_core.ApiError as e:
            if e.status_code != 404:
                raise
            return None
        return Blueprint(
            raw_blueprint=raw,
            field_types=field_types,
            rest_client_=self._rest_client,
        )

    def create_blueprint(
        self,
        parameters: typing.Optional[typing.Dict[str, typing.Any]] = None,
        fields_with_values: typing.Optional[
            typing.Dict[str, typing.Tuple[typing.Any, typing.Any, typing.Optional[str]]]
        ] = None,
        description: typing.Optional[str] = None,
        field_types: typing.Optional[typing.Dict[str, typing.Any]] = None,
    ) -> Blueprint:
        """Create a new blueprint and return it.

        Pass either ``parameters`` (plain key-value pairs whose types are
        inferred) or ``fields_with_values`` (explicit ``{key: (type, value)}``
        mapping). If both are given ``fields_with_values`` takes precedence.

        Args:
            parameters: Plain ``{field_name: value}`` dict; types are inferred
                via ``type(value)``.
            fields_with_values: Explicit ``{field_name: (python_type, value)}``
                mapping, bypassing type inference.
            description: Human-readable description stored with the blueprint.
            field_types: Mapping of prefixed field key to Python type used
                when fetching back the created blueprint.
        """
        fields_with_values = self._resolve_fields_with_values(
            parameters, fields_with_values
        )
        blueprint_id = id_helpers.generate_id()
        payload = self._build_blueprint_payload(
            fields_with_values, description, id=blueprint_id
        )
        self._rest_client.agent_configs.create_agent_config(
            blueprint=payload,
            project_name=self._project_name,
        )
        raw = self._rest_client.agent_configs.get_blueprint_by_id(blueprint_id)
        return Blueprint(
            raw_blueprint=raw,
            field_types=field_types,
            rest_client_=self._rest_client,
        )

    def tag_blueprint_with_env(self, env: str, blueprint_id: str) -> None:
        """Associate a blueprint with an environment name.

        Args:
            env: Environment name (e.g. ``"production"``).
            blueprint_id: ID of the blueprint to tag.
        """
        project_id = rest_helpers.resolve_project_id_by_name(
            self._rest_client, self._project_name
        )
        self._rest_client.agent_configs.create_or_update_envs(
            project_id=project_id,
            envs=[AgentConfigEnv(env_name=env, blueprint_id=blueprint_id)],
        )

    def create_mask(
        self,
        parameters: typing.Optional[typing.Dict[str, typing.Any]] = None,
        fields_with_values: typing.Optional[
            typing.Dict[str, typing.Tuple[typing.Any, typing.Any, typing.Optional[str]]]
        ] = None,
        description: typing.Optional[str] = None,
    ) -> str:
        """Create a mask blueprint and return its ID.

        A mask overlays a subset of fields on top of an existing blueprint.
        Apply it by passing the returned ID to ``get_blueprint(mask_id=...)``.

        Args:
            parameters: Plain ``{field_name: value}`` dict; types are inferred
                via ``type(value)``.
            fields_with_values: Explicit ``{field_name: (python_type, value)}``
                mapping, bypassing type inference.
            description: Human-readable description stored with the mask.
        """
        fields_with_values = self._resolve_fields_with_values(
            parameters, fields_with_values
        )
        mask_id = id_helpers.generate_id()
        payload = self._build_blueprint_payload(
            fields_with_values, description, id=mask_id, config_type="mask"
        )
        self._rest_client.agent_configs.create_agent_config(
            blueprint=payload,
            project_name=self._project_name,
        )
        return mask_id

    def create_or_update_blueprint(
        self,
        config: typing.Any,
        description: typing.Optional[str] = None,
    ) -> Blueprint:
        fields_with_values = config._extract_fields_with_values()
        existing = self.get_blueprint()

        if existing is not None:
            existing_keys = set(existing.values.keys())
            new_keys = set(fields_with_values.keys()) - existing_keys
            if not new_keys:
                logger.warning(
                    "A config already exists for this project with no new fields. "
                    "create_agent_config will be ignored. Use get_agent_config() to retrieve it."
                )
                return existing

            new_fields = {k: v for k, v in fields_with_values.items() if k in new_keys}

            logger.info(
                "Creating new config version with new fields: %s",
                ", ".join(sorted(new_keys)),
            )

            blueprint = self.create_blueprint(
                fields_with_values=new_fields,
                description=description,
            )
        else:
            # No existing config, create a new one with all fields and make it prod
            blueprint = self.create_blueprint(
                fields_with_values=fields_with_values,
                description=description,
            )

            if blueprint.id is not None:
                self.tag_blueprint_with_env(
                    env=constants.DEFAULT_AGENT_CONFIG_ENV,
                    blueprint_id=blueprint.id,
                )
        return blueprint

    def resolve_blueprint(
        self,
        version: typing.Optional[str] = None,
        env: typing.Optional[str] = None,
        id: typing.Optional[str] = None,
        mask_id: typing.Optional[str] = None,
        latest: bool = False,
    ) -> typing.Optional[Blueprint]:
        if latest:
            return self.get_blueprint(mask_id=mask_id)
        elif not any([id, version, env]):
            return self.get_blueprint(
                env=constants.DEFAULT_AGENT_CONFIG_ENV, mask_id=mask_id
            )
        else:
            return self.get_blueprint(
                id=id,
                version=version,
                env=env,
                mask_id=mask_id,
            )
