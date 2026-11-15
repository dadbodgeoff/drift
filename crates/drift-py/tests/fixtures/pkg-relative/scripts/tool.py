import os.path as osp
import mylib
import mylib.utils.text
import requests
from mylib import Engine, plugins, run_engine
from mylib.contrib import extra
from mylib.missing import nothing


def main() -> None:
    mylib.utils.text.slugify(osp.join("a", "b"))
    run_engine(Engine(plugins.Plugin()))
    extra.make()
    requests.get("https://example.com/api")
    mylib.core.run(None)
