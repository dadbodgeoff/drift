from rest_framework import serializers


class Model10Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
