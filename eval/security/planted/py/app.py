import sqlite3, os, random
from flask import Flask, request, render_template_string, send_file
from lxml import etree
app = Flask(__name__)
app.secret_key = "hardcoded-secret-key-1234567890"

@app.route("/a")
def a():
    c = sqlite3.connect("d").cursor()
    return str(c.execute(f"SELECT * FROM u WHERE n='{request.args['n']}'").fetchall())

@app.route("/b")
def b():
    q = f"SELECT * FROM u WHERE n='{request.args['n']}'"
    c = sqlite3.connect("d").cursor()
    return str(c.execute(q).fetchall())

@app.route("/c")
def c():
    return send_file(os.path.join("/data", request.args["f"]))

@app.route("/d")
def d():
    return render_template_string(request.args["t"])

@app.route("/e", methods=["POST"])
def e():
    return etree.tostring(etree.fromstring(request.data, etree.XMLParser(resolve_entities=True)))

@app.route("/f")
def f():
    return str(random.randint(100, 999))

if __name__ == "__main__":
    app.run(host="0.0.0.0", debug=True)
