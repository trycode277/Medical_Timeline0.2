class PipelineError(Exception):
    """Base class for errors whose message is safe to show to API clients
    (they never contain document text)."""


class OCRError(PipelineError):
    pass


class LLMConfigError(PipelineError):
    pass


class ExtractionError(PipelineError):
    pass


class SummaryError(PipelineError):
    pass
