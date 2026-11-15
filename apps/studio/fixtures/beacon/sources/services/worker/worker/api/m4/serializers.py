from rest_framework import serializers


class Model4Serializer(serializers.ModelSerializer):
    class Meta:
        fields = "__all__"
