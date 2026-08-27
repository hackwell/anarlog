import { defineConfig } from "@hey-api/openapi-ts";

export default defineConfig({
  input: "../../crates/api-client/openapi.upstream.json",
  output: "src/generated",
});
