import os

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "")
INSTALLED_APPS = ["django.contrib.contenttypes", "django.contrib.auth"]
MIDDLEWARE = []
ROOT_URLCONF = "proj.urls"
