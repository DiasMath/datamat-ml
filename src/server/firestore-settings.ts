// The SDK otherwise retries RESOURCE_EXHAUSTED for up to ten minutes.
// A daily quota cannot recover during a request. Preserve retries for transient
// read failures, and leave write/commit retry semantics with the SDK.
export const firestoreReadClientConfig = {
  interfaces: {
    "google.firestore.v1.Firestore": {
      retry_codes: {
        bounded_read: ["DEADLINE_EXCEEDED", "INTERNAL", "UNAVAILABLE"],
        bounded_begin: ["UNAVAILABLE"],
      },
      retry_params: {
        bounded_read: {
          initial_retry_delay_millis: 100,
          retry_delay_multiplier: 1.3,
          max_retry_delay_millis: 1000,
          initial_rpc_timeout_millis: 10000,
          rpc_timeout_multiplier: 1,
          max_rpc_timeout_millis: 10000,
          total_timeout_millis: 15000,
        },
      },
      methods: Object.fromEntries(
        [
          "GetDocument",
          "ListDocuments",
          "BatchGetDocuments",
          "RunQuery",
          "RunAggregationQuery",
          "BeginTransaction",
        ].map((method) => [
          method,
          {
            timeout_millis: 10000,
            retry_codes_name:
              method === "BeginTransaction" ? "bounded_begin" : "bounded_read",
            retry_params_name: "bounded_read",
          },
        ]),
      ),
    },
  },
};
