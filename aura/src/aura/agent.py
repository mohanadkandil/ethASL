from smolagents import CodeAgent, LiteLLMModel

from aura.tools import ALL_TOOLS

DEFAULT_MODEL = "openrouter/moonshotai/kimi-k2.5"


def create_agent(model_id: str | None = None) -> CodeAgent:
    """Create a flight analyzer agent."""
    model = LiteLLMModel(model_id or DEFAULT_MODEL)

    agent = CodeAgent(
        tools=ALL_TOOLS,
        model=model,
        additional_authorized_imports=["numpy", "pandas", "matplotlib"],
    )

    return agent
