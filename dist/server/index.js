export default {
  async fetch(request, env) {
    const response = await env.ASSETS.fetch(request);
    return response.status === 404
      ? env.ASSETS.fetch(new URL("/", request.url))
      : response;
  },
};
