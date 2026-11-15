import json


def load():
    with open("settings.json") as fp:
        return json.load(fp)
