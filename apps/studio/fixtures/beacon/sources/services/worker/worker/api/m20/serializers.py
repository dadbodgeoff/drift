from rest_framework import serializers


class Model20Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
