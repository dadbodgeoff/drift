from rest_framework import serializers


class Model5Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
