from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd
from sklearn.ensemble import IsolationForest
from smolagents import tool

from aura.parser import FlightLog, get_current_log, load_log

VALID_CHANNELS = [
    "Motor1", "Motor2", "Motor3", "Motor4",
    "GyrX", "GyrY", "GyrZ",
    "AccX", "AccY", "AccZ",
    "Alt", "Roll", "Pitch", "Yaw",
    "Voltage", "Current"
]


def validate_channel(channel: str) -> str | None:
    """Validate channel name and return error message if invalid."""
    if channel not in VALID_CHANNELS:
        return f"Invalid channel '{channel}'. Must be one of: {', '.join(VALID_CHANNELS)}"
    return None


LOGS_DIR = Path(__file__).parent.parent.parent / "logs"


@tool
def list_available_logs() -> str:
    """List all available flight log files in the logs directory."""
    if not LOGS_DIR.exists():
        return f"Logs directory not found: {LOGS_DIR}"

    logs = list(LOGS_DIR.glob("*.bin")) + list(LOGS_DIR.glob("*.tlog"))
    if not logs:
        return f"No log files found in {LOGS_DIR}"

    return "Available logs:\n" + "\n".join(f"  - {log.name}" for log in logs)


@tool
def load_flight_log(file_name: str) -> str:
    """Load and summarize a drone flight log file."""
    try:
        file_path = Path(file_name)
        if not file_path.exists():
            file_path = LOGS_DIR / file_name
        if not file_path.exists():
            return f"File not found: {file_name}. Use list_available_logs() to see available files."

        log = load_log(str(file_path))
        return log.summary()
    except Exception as e:
        return f"Error loading flight log: {e}"


@tool
def get_sensor_data(channel: str, t_start: float, t_end: float) -> str:
    """Get summary statistics for a sensor channel within a time window."""
    error = validate_channel(channel)
    if error:
        return error

    log = get_current_log()
    if log is None:
        return "No flight log loaded. Please load a log first."

    df = log.get_channel(channel, t_start, t_end)
    if df.empty:
        return f"No data found for channel '{channel}' in the specified time window."

    col = df.columns[0]
    data = df[col]

    mean_val = data.mean()
    std_val = data.std()
    min_val = data.min()
    max_val = data.max()
    min_time = data.idxmin()
    max_time = data.idxmax()

    diff = data.diff().abs()
    max_change = diff.max()
    max_change_time = diff.idxmax()

    lines = [
        f"{channel} from t={t_start:.1f}s to t={t_end:.1f}s:",
        f"  Mean: {mean_val:.2f}, Std: {std_val:.2f}",
        f"  Range: {min_val:.2f} (at {min_time:.1f}s) to {max_val:.2f} (at {max_time:.1f}s)",
    ]

    if std_val < mean_val * 0.05:
        lines.append(f"  Behavior: Stable around {mean_val:.1f}")
    elif max_change > std_val * 3:
        lines.append(f"  Behavior: Sudden change of {max_change:.2f} at t={max_change_time:.1f}s")
    else:
        lines.append(f"  Behavior: Variable with {std_val:.2f} standard deviation")

    if min_val == 0 and max_val > 0:
        zero_times = data[data == 0].index.tolist()
        if zero_times:
            lines.append(f"  WARNING: Dropped to zero at t={zero_times[0]:.1f}s")

    return "\n".join(lines)


@tool
def detect_anomalies(channel: str, t_start: float, t_end: float) -> str:
    """Detect anomalies in a sensor channel using Isolation Forest."""
    error = validate_channel(channel)
    if error:
        return error

    log = get_current_log()
    if log is None:
        return "No flight log loaded. Please load a log first."

    df = log.get_channel(channel, t_start, t_end)
    if df.empty:
        return f"No data found for channel '{channel}'."

    if len(df) < 10:
        return f"Not enough data points in {channel} for anomaly detection."

    col = df.columns[0]
    data = df[col].values.reshape(-1, 1)
    times = df.index.values

    clf = IsolationForest(contamination=0.05, random_state=42)
    predictions = clf.fit_predict(data)

    anomaly_mask = predictions == -1
    anomaly_times = times[anomaly_mask]
    anomaly_values = data[anomaly_mask].flatten()

    if len(anomaly_times) == 0:
        return f"No anomalies detected in {channel} between {t_start:.1f}s and {t_end:.1f}s."

    mean_val = data.mean()
    std_val = data.std()

    anomalies = []
    for t, v in zip(anomaly_times, anomaly_values):
        z_score = abs(v - mean_val) / std_val if std_val > 0 else 0
        if z_score > 3:
            severity = "critical"
        elif z_score > 2:
            severity = "high"
        else:
            severity = "moderate"
        anomalies.append({"time": t, "value": v, "severity": severity})

    lines = [f"Anomalies in {channel} ({t_start:.1f}s to {t_end:.1f}s):"]

    critical = [a for a in anomalies if a["severity"] == "critical"]
    high = [a for a in anomalies if a["severity"] == "high"]
    moderate = [a for a in anomalies if a["severity"] == "moderate"]

    if critical:
        lines.append(f"  CRITICAL ({len(critical)}): " + ", ".join(f"t={a['time']:.1f}s" for a in critical[:3]))
    if high:
        lines.append(f"  High ({len(high)}): " + ", ".join(f"t={a['time']:.1f}s" for a in high[:3]))
    if moderate:
        lines.append(f"  Moderate ({len(moderate)}): {len(moderate)} instances")

    return "\n".join(lines)


@tool
def correlate_channels(channel_a: str, channel_b: str, t_start: float, t_end: float) -> str:
    """Compute correlation between two sensor channels."""
    error_a = validate_channel(channel_a)
    if error_a:
        return error_a
    error_b = validate_channel(channel_b)
    if error_b:
        return error_b

    log = get_current_log()
    if log is None:
        return "No flight log loaded. Please load a log first."

    df_a = log.get_channel(channel_a, t_start, t_end)
    df_b = log.get_channel(channel_b, t_start, t_end)

    if df_a.empty or df_b.empty:
        return "Could not retrieve data for one or both channels."

    combined = pd.concat([df_a, df_b], axis=1).dropna()
    if len(combined) < 10:
        return "Not enough overlapping data points for correlation analysis."

    col_a = combined.columns[0]
    col_b = combined.columns[1]

    correlation = combined[col_a].corr(combined[col_b])

    a_norm = (combined[col_a] - combined[col_a].mean()) / combined[col_a].std()
    b_norm = (combined[col_b] - combined[col_b].mean()) / combined[col_b].std()

    best_lag = 0
    best_corr = correlation
    for lag in range(-10, 11):
        if lag == 0:
            continue
        shifted_corr = a_norm.shift(lag).corr(b_norm)
        if abs(shifted_corr) > abs(best_corr):
            best_corr = shifted_corr
            best_lag = lag

    dt = (combined.index[-1] - combined.index[0]) / len(combined)
    lag_seconds = best_lag * dt

    lines = [f"Correlation between {channel_a} and {channel_b} ({t_start:.1f}s to {t_end:.1f}s):"]
    lines.append(f"  Pearson correlation: {correlation:.3f}")

    if abs(correlation) > 0.7:
        direction = "positive" if correlation > 0 else "negative"
        lines.append(f"  Strong {direction} correlation detected.")
    elif abs(correlation) > 0.4:
        lines.append("  Moderate correlation detected.")
    else:
        lines.append("  Weak or no linear correlation.")

    if abs(best_lag) > 0 and abs(best_corr) > abs(correlation) + 0.1:
        leader = channel_a if best_lag > 0 else channel_b
        follower = channel_b if best_lag > 0 else channel_a
        lines.append(f"  Time lag: {leader} leads {follower} by ~{abs(lag_seconds):.2f}s")

    return "\n".join(lines)


@tool
def plot_data(channels: str, t_start: float, t_end: float) -> str:
    """Generate a plot of sensor data and save to file."""
    channels = [c.strip() for c in channels.split(",")]
    log = get_current_log()
    if log is None:
        return "No flight log loaded. Please load a log first."

    fig, axes = plt.subplots(len(channels), 1, figsize=(12, 3 * len(channels)), sharex=True)
    if len(channels) == 1:
        axes = [axes]

    for ax, channel in zip(axes, channels):
        df = log.get_channel(channel, t_start, t_end)
        if not df.empty:
            col = df.columns[0]
            ax.plot(df.index, df[col], label=channel, linewidth=0.8)
            ax.set_ylabel(channel)
            ax.legend(loc="upper right")
            ax.grid(True, alpha=0.3)
        else:
            ax.text(0.5, 0.5, f"No data for {channel}", ha="center", va="center")

    axes[-1].set_xlabel("Time (s)")
    plt.tight_layout()

    output_dir = Path("plots")
    output_dir.mkdir(exist_ok=True)
    plot_path = output_dir / f"plot_{t_start:.0f}_{t_end:.0f}.png"
    plt.savefig(plot_path, dpi=150)
    plt.close()

    return str(plot_path)


ALL_TOOLS = [
    list_available_logs,
    load_flight_log,
    get_sensor_data,
    detect_anomalies,
    correlate_channels,
    plot_data,
]
