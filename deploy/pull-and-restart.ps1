param(
  [Parameter(Mandatory = $true)]
  [string]$Image
)

$ErrorActionPreference = 'Stop'
$env:TOURVEX_API_IMAGE = $Image
docker compose -f docker-compose.prod.yml pull api
docker compose -f docker-compose.prod.yml up -d --remove-orphans api
docker image prune -f
