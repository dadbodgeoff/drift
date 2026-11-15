import os

SECRET_KEY = os.environ["DJANGO_SECRET_KEY"]
DEBUG = False
ROOT_URLCONF = "mysite.urls"
CORS_ALLOW_ALL_ORIGINS = True
INSTALLED_APPS = ["blog", "rest_framework", "django_celery_beat"]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
]
if not DEBUG:
    MIDDLEWARE += ["django.contrib.auth.middleware.LoginRequiredMiddleware"]

REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["rest_framework.authentication.TokenAuthentication"],
    "PAGE_SIZE": 20,
}
REST_FRAMEWORK["DEFAULT_PERMISSION_CLASSES"] = ("blog.permissions.IsMember",)

CELERY_BEAT_SCHEDULE = {
    "purge-drafts": {
        "task": "blog.tasks.purge_drafts",
        "schedule": 3600,
    },
}
