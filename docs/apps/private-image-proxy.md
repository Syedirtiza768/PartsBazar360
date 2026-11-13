# private-image-proxy

**Last reviewed:** 2026-10-12

Small internal Node service that reads buyer-facing inventory photos from the
private S3 bucket `solarrisebackupbucket-530142863136`. Nginx sends only image
requests for the exact bucket host and `mhn/catalog-images/inventory/` prefix
to this service. It validates the bucket and path again, streams image objects,
and rejects other hosts, keys, methods, non-image objects, and oversized files.

The service is defined in `docker-compose.private-images.yml`, has no published
host port, and receives `/home/ubuntu/.aws/credentials` as a read-only mount.
The app server's default AWS profile must be able to call `s3:GetObject` for
the allowed image prefix. Keep credentials out of the repository and browser;
the bucket's public-access block remains enabled. Nginx caches successful
responses to reduce repeated S3 reads.

Production updates use `update.sh`, which composes the base stack with the
private-image overlay and verifies that the credential file is readable before
rebuilding. Other external image hosts continue through the existing Nginx
proxy path.
