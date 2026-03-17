import copy
import dataclasses
import logging
import typing

from .blueprint import Blueprint
from .context import get_active_config_mask
from . import type_helpers

if typing.TYPE_CHECKING:
    from .service import AgentConfigService

logger = logging.getLogger(__name__)

_MISSING = object()


class AgentConfig:
    """User-facing base class for typed agent configurations.

    Subclass to define a config schema::

        class MyConfig(AgentConfig):
            model: str = "gpt-4"
            temperature: float = 0.7
            max_tokens: int = 2000

    Supported field types: ``str``, ``int``, ``float``, ``bool``, ``Prompt``.

    Subclass instances can be passed to ``Opik.create_agent_config()``.
    When returned from ``Opik.get_agent_config()``, supports dict-like access via
    ``config["key"]``, ``config.get("key")``, and ``config.values``.

    Context masks are supported: when accessed inside an
    ``agent_config_context(mask_id=...)``, values from the mask blueprint
    take precedence.
    """

    _values: typing.Dict[str, typing.Any]
    _blueprint_id: typing.Optional[str]
    _blueprint_envs: typing.Optional[typing.List[str]]
    _service: typing.Optional["AgentConfigService"]
    _mask_cache: typing.Dict[str, typing.Dict[str, typing.Any]]
    _field_metadata: typing.Dict[str, typing.Tuple[str, typing.Optional[str]]]
    _is_fallback: bool

    def __init_subclass__(cls, **kwargs: typing.Any) -> None:
        super().__init_subclass__(**kwargs)
        if not dataclasses.is_dataclass(cls):
            dataclasses.dataclass(cls)

    @classmethod
    def _from_blueprint(
        cls,
        blueprint: Blueprint,
        service: typing.Optional["AgentConfigService"] = None,
    ) -> "AgentConfig":
        """Create an AgentConfig populated from a Blueprint."""
        instance = object.__new__(cls)
        instance._values = blueprint.values
        instance._blueprint_id = blueprint.id
        instance._blueprint_envs = blueprint.envs
        instance._service = service
        instance._mask_cache = {}
        instance._field_metadata = {
            v.key: (v.type, v.description) for v in blueprint._raw.values
        }
        instance._is_fallback = False
        return instance

    def _resolve_masked_value(self, key: str) -> typing.Any:
        """Check the active context mask for an override value.

        Returns the masked value or ``_MISSING`` if no mask is active
        or the mask doesn't contain the key.
        """
        context_mask = get_active_config_mask()
        if context_mask is None or self._service is None:
            return _MISSING

        try:
            if context_mask not in self._mask_cache:
                env = self._blueprint_envs[0] if self._blueprint_envs else None
                bp = self._service.get_blueprint(
                    mask_id=context_mask,
                    env=env,
                )
                self._mask_cache[context_mask] = bp.values if bp is not None else {}

            masked_values = self._mask_cache[context_mask]
            if key in masked_values:
                return masked_values[key]
        except Exception as e:
            logger.warning(
                "Failed to resolve masked config value for mask_id=%s, key=%s: %s",
                context_mask,
                key,
                e,
                exc_info=True,
            )

        return _MISSING

    def _extract_fields_with_values(
        self,
    ) -> typing.Dict[str, typing.Tuple[typing.Any, typing.Any, typing.Optional[str]]]:
        """Extract typed fields from this subclass instance.

        Returns:
            Dict of ``{field_name: (python_type, value, description)}``.
        """
        # AgentConfigService is a forward ref on private fields (skipped below),
        # stub it so get_type_hints doesn't raise NameError.
        hints = typing.get_type_hints(
            type(self),
            include_extras=True,
            localns={"AgentConfigService": typing.Any},
        )
        result: typing.Dict[
            str, typing.Tuple[typing.Any, typing.Any, typing.Optional[str]]
        ] = {}

        for name, raw_hint in hints.items():
            if name.startswith("_"):
                continue

            description: typing.Optional[str] = None
            if typing.get_origin(raw_hint) is typing.Annotated:
                args = typing.get_args(raw_hint)
                py_type = args[0]
                description = next((a for a in args[1:] if isinstance(a, str)), None)
            else:
                py_type = raw_hint

            inner = type_helpers.unwrap_optional(py_type)
            if inner is not None:
                py_type = inner

            if not type_helpers.is_supported_type(py_type):
                continue

            value = getattr(self, name, _MISSING)
            if value is not _MISSING:
                result[name] = (py_type, value, description)

        return result

    def _ensure_internal_state(self) -> None:
        """Populate internal attrs from dataclass fields if not already set."""
        if hasattr(self, "_values"):
            return
        fields = self._extract_fields_with_values()
        self._values = {k: v for k, (_, v, _) in fields.items()}
        self._blueprint_id = None
        self._blueprint_envs = None
        self._service = None
        self._mask_cache = {}
        self._field_metadata = {
            k: (type_helpers.python_type_to_backend_type(py_type), desc)
            for k, (py_type, _, desc) in fields.items()
        }

    @property
    def values(self) -> typing.Dict[str, typing.Any]:
        """All config values as a dict."""
        return copy.deepcopy(self._values)

    @property
    def id(self) -> typing.Optional[str]:
        """The blueprint ID backing this config."""
        return self._blueprint_id

    @property
    def envs(self) -> typing.Optional[typing.List[str]]:
        """Environment names tagged to the backing blueprint."""
        return self._blueprint_envs

    @property
    def is_fallback(self) -> bool:
        """Whether this config is a local fallback (backend was unreachable)."""
        return self._is_fallback

    def _inject_trace_metadata(
        self,
        key: str,
        value: typing.Any,
        mask_id: typing.Optional[str] = None,
    ) -> None:
        """Attach the accessed config value to the active trace's metadata.

        No-ops silently when there is no active trace or on any error.
        Raises ``ValueError`` if the active trace belongs to a different
        project than the agent config.
        """
        from opik import exceptions, opik_context, context_storage

        trace_data = context_storage.get_trace_data()
        if trace_data is None:
            return

        if (
            self._service is not None
            and trace_data.project_name is not None
            and trace_data.project_name != self._service.project_name
        ):
            raise ValueError(
                f"Agent config belongs to project "
                f"'{self._service.project_name}', but the active trace "
                f"belongs to project '{trace_data.project_name}'. "
                f"Use the same project for both."
            )

        try:
            # ALEX
            # add the version
            agent_config_metadata: typing.Dict[str, typing.Any] = {
                "blueprint_id": self._blueprint_id,
            }
            if mask_id is not None:
                agent_config_metadata["_mask_id"] = mask_id

            values: typing.Dict[str, typing.Any] = {}
            field_meta = self._field_metadata.get(key)
            if value is not _MISSING and field_meta is not None:
                backend_type, description = field_meta
                values[key] = {
                    "value": type_helpers.python_value_to_metadata_value(
                        value, type(value)
                    ),
                    "type": backend_type,
                    **({"description": description} if description is not None else {}),
                }
            agent_config_metadata["values"] = values

            opik_context.update_current_trace(
                metadata={"agent_configuration": agent_config_metadata}
            )
        except exceptions.OpikException:
            pass
        except Exception:
            logger.debug("Failed to inject config metadata into trace", exc_info=True)

    def get(self, key: str, default: typing.Any = None) -> typing.Any:
        """Get a config value by key, with an optional default."""
        masked = self._resolve_masked_value(key)
        if masked is not _MISSING:
            self._inject_trace_metadata(key, masked, mask_id=get_active_config_mask())
            return masked
        value = self._values.get(key, default)
        self._inject_trace_metadata(key, value)
        return value

    def __getitem__(self, key: str) -> typing.Any:
        masked = self._resolve_masked_value(key)
        if masked is not _MISSING:
            self._inject_trace_metadata(key, masked, mask_id=get_active_config_mask())
            return masked
        value = self._values[key]
        self._inject_trace_metadata(key, value)
        return value

    def __getattr__(self, name: str) -> typing.Any:
        if name.startswith("_"):
            raise AttributeError(name)
        try:
            return self[name]
        except KeyError:
            raise AttributeError(name)

    # ALEX
    # to do: remove
    def create_mask(
        self,
        parameters: typing.Dict[str, typing.Any],
        description: typing.Optional[str] = None,
    ) -> str:
        """Create a mask blueprint and return its ID.

        Args:
            parameters: ``{field_name: value}`` overrides to apply on top of this config.
            description: Human-readable description stored with the mask.

        Returns:
            The mask ID, usable with ``get_agent_config(mask_id=...)`` or
            ``agent_config_context(mask_id=...)``.
        """
        if self._service is None:
            raise RuntimeError(
                "Cannot create a mask on a locally-created config. "
                "Use a config returned from create_agent_config() or get_agent_config()."
            )
        return self._service.create_mask(
            parameters=parameters,
            description=description,
        )

    def update_env(self, env: str) -> None:
        """Tag this config's blueprint with an environment name.

        Args:
            env: Environment name to associate (e.g. ``"dev"``, ``"prod"``).
        """
        if self._service is None:
            raise RuntimeError(
                "Cannot update env on a locally-created config. "
                "Use a config returned from create_agent_config() or get_agent_config()."
            )

        if self._blueprint_id is None:
            raise ValueError("This config has no blueprint ID to tag.")

        self._service.tag_blueprint_with_env(
            env=env,
            blueprint_id=self._blueprint_id,
        )

        refreshed = self._service.get_blueprint(id=self._blueprint_id)
        if refreshed is not None:
            self._blueprint_envs = refreshed.envs

    def keys(self) -> typing.KeysView[str]:
        return self._values.keys()
