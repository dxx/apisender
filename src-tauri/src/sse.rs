use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SseEvent {
    pub id: Option<String>,
    pub event: String,
    pub data: String,
    pub retry: Option<u64>,
    pub index: usize,
}

#[derive(Debug, Default)]
struct PendingEvent {
    id: Option<String>,
    event: Option<String>,
    data_lines: Vec<String>,
    retry: Option<u64>,
}

pub struct SseParser {
    buffer: String,
    pending: PendingEvent,
    event_index: usize,
}

impl SseParser {
    pub fn new() -> Self {
        Self {
            buffer: String::new(),
            pending: PendingEvent::default(),
            event_index: 0,
        }
    }

    pub fn feed(&mut self, bytes: &[u8]) -> Vec<SseEvent> {
        let text = String::from_utf8_lossy(bytes);
        self.buffer.push_str(&text);
        self.drain_completed()
    }

    pub fn finish(mut self) -> Vec<SseEvent> {
        if !self.pending.is_empty() {
            let evt = self.pending_to_event();
            if !evt.data.is_empty() || evt.id.is_some() || evt.event != "message" {
                return vec![evt];
            }
        }
        vec![]
    }

    fn drain_completed(&mut self) -> Vec<SseEvent> {
        let mut events = Vec::new();
        loop {
            let Some(line_end) = self.buffer.find('\n') else {
                break;
            };
            let raw_line: String = self.buffer.drain(..=line_end).collect();
            let line = raw_line.strip_suffix('\n').unwrap_or(&raw_line);
            let line = line.strip_suffix('\r').unwrap_or(line);

            if line.is_empty() {
                if !self.pending.is_empty() {
                    let evt = self.pending_to_event();
                    if !evt.data.is_empty() || evt.id.is_some() || evt.event != "message" {
                        events.push(evt);
                    }
                }
                self.pending = PendingEvent::default();
                continue;
            }

            self.process_line(line);
        }
        events
    }

    fn process_line(&mut self, line: &str) {
        if let Some(rest) = line.strip_prefix(':') {
            let _ = rest;
            return;
        }
        let (field, value) = if let Some(idx) = line.find(':') {
            let f = &line[..idx];
            let v = line[idx + 1..].strip_prefix(' ').unwrap_or(&line[idx + 1..]);
            (f, v)
        } else {
            (line, "")
        };
        match field {
            "data" => {
                self.pending.data_lines.push(value.to_string());
            }
            "event" => {
                self.pending.event = Some(value.to_string());
            }
            "id" => {
                self.pending.id = Some(value.to_string());
            }
            "retry" => {
                if let Ok(ms) = value.parse::<u64>() {
                    self.pending.retry = Some(ms);
                }
            }
            _ => {}
        }
    }

    fn pending_to_event(&mut self) -> SseEvent {
        self.event_index += 1;
        SseEvent {
            id: self.pending.id.take(),
            event: self.pending.event.take().unwrap_or_else(|| "message".to_string()),
            data: self.pending.data_lines.join("\n"),
            retry: self.pending.retry.take(),
            index: self.event_index - 1,
        }
    }
}

impl PendingEvent {
    fn is_empty(&self) -> bool {
        self.id.is_none() && self.event.is_none() && self.data_lines.is_empty() && self.retry.is_none()
    }
}
