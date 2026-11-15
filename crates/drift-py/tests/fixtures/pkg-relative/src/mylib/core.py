from typing import TYPE_CHECKING

from .base import Base
from .utils import *
from .utils.text import slugify

if TYPE_CHECKING:
    from .plugins import Plugin


class Engine(Base):
    def __init__(self, plugin: "Plugin") -> None:
        self.plugin = plugin

    def name(self) -> str:
        return slugify(helper("engine"))


def run(engine: Engine) -> None:
    def inner(slugify: str) -> str:
        # `slugify` is a parameter here, not the import.
        return slugify.upper()

    engine.start()
    inner("x")
    raise RuntimeError("stopped")
