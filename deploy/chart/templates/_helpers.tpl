{{- define "metaprompt.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "metaprompt.labels" -}}
app.kubernetes.io/name: {{ include "metaprompt.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/part-of: metaprompt
{{- end -}}
