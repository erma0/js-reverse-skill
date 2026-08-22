"""Case adapter contract (example only).

Copy to result/src/adapter.py only after this case has a real successful
wire capture and RuyiTrace. Implement every method from that evidence;
do not add guessed vendor defaults.
"""


def load_challenge(_session, _config):
    raise NotImplementedError("Implement bootstrap/load sequence from this case evidence")


def resolve_assets(_session, _config, _load_result):
    raise NotImplementedError("Implement asset resolution from this case evidence")


def prepare_answer(answer, **_context):
    return answer


def build_verify_request(**_context):
    raise NotImplementedError("Implement exact method, URL, query/body serialization and headers from this case evidence")


def parse_verify_response(_response, **_context):
    raise NotImplementedError("Implement response/JSONP parsing and credential validation from this case evidence")


def consume_credential(_session, _config, _credential):
    raise NotImplementedError("Implement business credential consumption and success semantics from this case evidence")
