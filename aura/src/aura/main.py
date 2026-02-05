import sys
from smolagents import ToolCallingAgent, LiteLLMModel

from aura.tools import ALL_TOOLS, LOGS_DIR, load_flight_log

DEFAULT_MODEL = "openrouter/openai/gpt-4o-mini"


def create_agent(model_id: str) -> ToolCallingAgent:
    """Create a flight analyzer agent."""
    model = LiteLLMModel(model_id)
    return ToolCallingAgent(
        tools=ALL_TOOLS,
        model=model,
        verbosity_level=1,  # Show steps
    )


def auto_load_log() -> str | None:
    """Auto-load the first .bin file found in logs directory."""
    logs = list(LOGS_DIR.glob("*.bin"))
    if not logs:
        logs = list(LOGS_DIR.glob("*.tlog"))
    if logs:
        log_file = logs[0]
        summary = load_flight_log(log_file.name)
        return log_file.name, summary
    return None, None


def main():
    """Run CLI chat."""
    model_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_MODEL

    print("=" * 60)
    print("  AURA - Drone Flight Log Analyzer")
    print("=" * 60)
    print(f"Model: {model_id}")
    print()

    # Auto-load first log
    log_name, log_summary = auto_load_log()
    if log_name:
        print(f"Auto-loaded: {log_name}")
        print("-" * 60)
        print(log_summary)
        print("-" * 60)
    else:
        print(f"No logs found in {LOGS_DIR}")

    print()
    print("Commands: /logs, /load <file>, /reset, /quit")
    print("=" * 60)
    print()

    agent = create_agent(model_id)

    while True:
        try:
            user_input = input("\033[94mYou:\033[0m ").strip()
        except (KeyboardInterrupt, EOFError):
            print("\nGoodbye!")
            break

        if not user_input:
            continue

        if user_input.lower() == "/quit":
            print("Goodbye!")
            break

        if user_input.lower() == "/logs":
            logs = list(LOGS_DIR.glob("*.bin")) + list(LOGS_DIR.glob("*.tlog"))
            if logs:
                print("\nAvailable logs:")
                for log in logs:
                    print(f"  - {log.name}")
            else:
                print(f"\nNo logs found in {LOGS_DIR}")
            print()
            continue

        if user_input.lower().startswith("/load "):
            file_name = user_input[6:].strip()
            summary = load_flight_log(file_name)
            print(f"\n{summary}\n")
            continue

        if user_input.lower() == "/reset":
            agent = create_agent(model_id)
            print("Conversation reset.\n")
            continue

        try:
            print()
            response = agent.run(user_input, reset=False)
            print(f"\n\033[92mAgent:\033[0m {response}\n")
        except Exception as e:
            print(f"\n\033[91mError:\033[0m {e}\n")


if __name__ == "__main__":
    main()
