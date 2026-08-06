"use strict";

const { GRAPHQL_ENDPOINT } = require("../config");
const { withRetry } = require("./retry");

/**
 * Posts a GraphQL request. Retries on network errors / non-2xx / GraphQL
 * `errors[]`. Does NOT retry on a `GenericError` union member returned
 * inside `data` — that's a valid API response (e.g. product not found),
 * not a transient failure, so it's returned as-is for the caller to check.
 */
async function graphqlRequest(operationName, query, variables, label) {
  return withRetry(async () => {
    const res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: {
        accept: "*/*",
        "content-type": "application/json",
      },
      body: JSON.stringify({ operationName, query, variables }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const json = await res.json();

    if (json.errors && json.errors.length > 0) {
      throw new Error(json.errors.map((e) => e.message).join("; "));
    }

    return json.data;
  }, label || operationName);
}

module.exports = { graphqlRequest };
