from __future__ import annotations
import asyncio
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

@dataclass
class AgentSession:
    id: str
    agent_id: str
    created_at: datetime = field(
        default_factory=lambda: datetime.now(timezone.utc)
    )
    metadata: dict[str, Any] = field(default_factory=dict)
    _cancel_event: asyncio.Event = field(init=False, repr=False)

    def __post_init__(self) -> None:
        self._cancel_event = asyncio.Event()

    async def run(self) -> None:
        """Execute the session until completion or cancellation."""
        try:
            while not self._cancel_event.is_set():
                await self._step()
