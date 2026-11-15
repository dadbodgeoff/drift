from rest_framework import serializers


class Model3Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
