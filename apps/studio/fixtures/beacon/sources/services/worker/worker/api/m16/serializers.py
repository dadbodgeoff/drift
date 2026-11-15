from rest_framework import serializers


class Model16Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
