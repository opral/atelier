export default {
	async fetch(request, env) {
		const url = new URL(request.url);
		url.pathname += ".gz";

		const asset = await env.ASSETS.fetch(new Request(url, request));
		if (!asset.ok) {
			return asset;
		}

		const headers = new Headers(asset.headers);
		headers.set("Content-Encoding", "gzip");
		headers.set("Content-Type", "application/wasm");

		return new Response(asset.body, {
			status: asset.status,
			headers,
			encodeBody: "manual",
		});
	},
};
