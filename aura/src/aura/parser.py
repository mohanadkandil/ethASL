"""Flight log parsing utilities using pymavlink."""

from pathlib import Path

import pandas as pd
from pymavlink import mavutil


# Message types we care about
MESSAGE_TYPES = {
    "IMU": ["TimeUS", "GyrX", "GyrY", "GyrZ", "AccX", "AccY", "AccZ"],
    "RCOU": ["TimeUS", "C1", "C2", "C3", "C4", "C5", "C6", "C7", "C8"],
    "BARO": ["TimeUS", "Alt", "Press", "Temp"],
    "GPS": ["TimeUS", "Lat", "Lng", "Alt", "Spd", "NSats"],
    "ATT": ["TimeUS", "Roll", "Pitch", "Yaw"],
    "MODE": ["TimeUS", "Mode", "ModeNum"],
    "ERR": ["TimeUS", "Subsys", "ECode"],
    "CURR": ["TimeUS", "Curr", "Volt"],
    "VIBE": ["TimeUS", "VibeX", "VibeY", "VibeZ"],
    "MOT": ["TimeUS", "Mot1", "Mot2", "Mot3", "Mot4"],
}


class FlightLog:
    """Parsed flight log with sensor data as DataFrames."""

    def __init__(self, file_path: str | Path):
        self.file_path = Path(file_path)
        self.data: dict[str, pd.DataFrame] = {}
        self.metadata: dict = {}
        self._parse()

    def _parse(self) -> None:
        """Parse the .bin file into DataFrames."""
        mlog = mavutil.mavlink_connection(str(self.file_path))

        messages: dict[str, list[dict]] = {msg_type: [] for msg_type in MESSAGE_TYPES}

        while True:
            msg = mlog.recv_match()
            if msg is None:
                break

            msg_type = msg.get_type()
            if msg_type in MESSAGE_TYPES:
                row = {}
                for field in MESSAGE_TYPES[msg_type]:
                    if hasattr(msg, field):
                        row[field] = getattr(msg, field)
                if row:
                    messages[msg_type].append(row)

        # Convert to DataFrames with time index
        for msg_type, rows in messages.items():
            if rows:
                df = pd.DataFrame(rows)
                if "TimeUS" in df.columns:
                    # Convert microseconds to seconds
                    df["time_s"] = df["TimeUS"] / 1e6
                    df = df.set_index("time_s").drop(columns=["TimeUS"])
                self.data[msg_type] = df

        # Extract metadata
        if self.data:
            all_times = []
            for df in self.data.values():
                if len(df) > 0:
                    all_times.extend([df.index.min(), df.index.max()])
            if all_times:
                self.metadata["start_time"] = min(all_times)
                self.metadata["end_time"] = max(all_times)
                self.metadata["duration"] = self.metadata["end_time"] - self.metadata["start_time"]

        self.metadata["channels"] = list(self.data.keys())
        self.metadata["file_name"] = self.file_path.name

    def get_channel(self, channel: str, t_start: float | None = None, t_end: float | None = None) -> pd.DataFrame:
        """Get data for a specific channel within a time window."""
        # Handle channel names like "Motor3" -> RCOU.C3
        channel_map = {
            "Motor1": ("RCOU", "C1"),
            "Motor2": ("RCOU", "C2"),
            "Motor3": ("RCOU", "C3"),
            "Motor4": ("RCOU", "C4"),
            "GyrX": ("IMU", "GyrX"),
            "GyrY": ("IMU", "GyrY"),
            "GyrZ": ("IMU", "GyrZ"),
            "AccX": ("IMU", "AccX"),
            "AccY": ("IMU", "AccY"),
            "AccZ": ("IMU", "AccZ"),
            "Alt": ("BARO", "Alt"),
            "Roll": ("ATT", "Roll"),
            "Pitch": ("ATT", "Pitch"),
            "Yaw": ("ATT", "Yaw"),
            "Voltage": ("CURR", "Volt"),
            "Current": ("CURR", "Curr"),
        }

        if channel in channel_map:
            msg_type, field = channel_map[channel]
            if msg_type not in self.data:
                return pd.DataFrame()
            df = self.data[msg_type][[field]].copy()
            df.columns = [channel]
        elif channel in self.data:
            df = self.data[channel].copy()
        else:
            return pd.DataFrame()

        # Apply time window
        if t_start is not None:
            df = df[df.index >= t_start]
        if t_end is not None:
            df = df[df.index <= t_end]

        return df

    def summary(self) -> str:
        """Generate a human-readable summary of the flight."""
        duration = self.metadata.get("duration", 0)
        mins = int(duration // 60)
        secs = int(duration % 60)

        lines = [
            f"Flight: {self.metadata.get('file_name', 'unknown')}",
            f"Duration: {mins}m {secs}s",
            f"Channels available: {', '.join(self.metadata.get('channels', []))}",
        ]

        # Add mode changes if available
        if "MODE" in self.data and len(self.data["MODE"]) > 0:
            modes = self.data["MODE"]["Mode"].unique().tolist()
            lines.append(f"Flight modes: {', '.join(str(m) for m in modes)}")

        # Add error codes if any
        if "ERR" in self.data and len(self.data["ERR"]) > 0:
            errors = len(self.data["ERR"])
            lines.append(f"Errors logged: {errors}")

        return "\n".join(lines)


_current_log: FlightLog | None = None


def load_log(file_path: str) -> FlightLog:
    """Load a flight log and store as current."""
    global _current_log
    _current_log = FlightLog(file_path)
    return _current_log


def get_current_log() -> FlightLog | None:
    """Get the currently loaded flight log."""
    return _current_log
