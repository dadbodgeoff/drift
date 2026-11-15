from django import forms
from django.db import models
from rest_framework import permissions, viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.viewsets import ModelViewSet


class TagViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]


class LabelViewSet(ModelViewSet):
    permission_classes = [permissions.IsAuthenticated]


def fields():
    return models.CharField(), forms.CharField()
