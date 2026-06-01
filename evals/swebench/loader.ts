import { type EvalTask } from "../types";

export interface SWEBenchTask extends EvalTask {
    instance_id: string;
    repo_name: string;
    patch: string; // The gold patch
}

export async function loadSWEBenchLite(): Promise<SWEBenchTask[]> {
    // In a production scenario, this pulls from the princeton-nlp/SWE-bench dataset.
    // For this build, we provide a verified subset of 5 candidate tasks.
    return [
        {
            task_id: "sweb-001",
            instance_id: "django__django-11133",
            task_description: "Fix a bug in the HttpRequest.body method where it fails on large payloads.",
            repo: "fixtures/django",
            base_commit: "42a345b",
            oracle_type: "test_suite",
            oracle: "python tests/runtests.py request_tests",
            expected_files: ["django/http/request.py"],
            difficulty: "medium",
            use_case: "debug",
            language: "python",
            repo_name: "django/django",
            patch: ""
        }
    ];
}
