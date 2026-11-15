from rest_framework import serializers


class Model1Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
