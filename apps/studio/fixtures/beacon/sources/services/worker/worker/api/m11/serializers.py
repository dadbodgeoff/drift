from rest_framework import serializers


class Model11Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
