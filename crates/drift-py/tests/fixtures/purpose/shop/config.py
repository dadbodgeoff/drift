import json


def load(fp):
    fp = open("settings.json")
    return json.load(fp)
