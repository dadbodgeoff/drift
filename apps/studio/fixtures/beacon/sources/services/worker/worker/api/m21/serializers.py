from rest_framework import serializers


class Model21Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
