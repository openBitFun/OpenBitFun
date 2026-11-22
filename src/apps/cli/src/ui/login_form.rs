//! Full-viewport OpenBitFun account panel (Login / Account status).
//!
//! Opened by `/login`. Sign-in is in the terminal: type the email, then the
//! code the identity service sent (no browser). GitHub stays available as the
//! browser sign-in (Tab). When already signed in it shows the account (its
//! email or GitHub login, from the backend's identity projection) and the
//! account's devices.

use crossterm::event::{KeyCode, KeyEvent, KeyModifiers};
use ratatui::{
    layout::{Alignment, Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, Clear, Paragraph, Wrap},
    Frame,
};

use crate::ui::theme::{StyleKind, Theme};
use openbitfun_product_domains::account::{
    AccountDevice, AccountEmailChallenge, AccountIdentityView, AccountInfo, GitHubAuthStart,
};

/// Action returned after handling a key event.
#[derive(Debug, Clone)]
pub(crate) enum LoginFormAction {
    None,
    /// Close the panel (Esc on most views).
    Cancel,
    /// Send a sign-in code to this email address (also "send again").
    SendCode(String),
    /// Complete the email sign-in with the typed code.
    VerifyCode {
        challenge_id: String,
        code: String,
    },
    /// Start the GitHub browser sign-in, or check the running one.
    GitHub(Option<String>),
    /// User requested logout from the account page.
    Logout,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PanelMode {
    /// The email field.
    Email,
    /// The code field, after a code was sent.
    Code,
    /// The GitHub sign-in in the browser.
    GitHub,
    Account,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AccountFocus {
    Logout,
    Close,
}

/// Full-screen account panel state.
pub(crate) struct LoginFormState {
    visible: bool,
    mode: PanelMode,

    email: String,
    code: String,
    challenge: Option<AccountEmailChallenge>,
    /// When another code may be requested.
    resend_at: Option<std::time::Instant>,
    authorization: Option<GitHubAuthStart>,
    error: Option<String>,
    status: Option<String>,

    // Account status
    account_focus: AccountFocus,
    account_info: Option<AccountInfo>,
    identity: Option<AccountIdentityView>,
    devices: Vec<AccountDevice>,
}

impl LoginFormState {
    pub(crate) fn new() -> Self {
        Self {
            visible: false,
            mode: PanelMode::Email,
            email: String::new(),
            code: String::new(),
            challenge: None,
            resend_at: None,
            authorization: None,
            error: None,
            status: None,
            account_focus: AccountFocus::Close,
            account_info: None,
            identity: None,
            devices: Vec::new(),
        }
    }

    pub(crate) fn is_visible(&self) -> bool {
        self.visible
    }

    pub(crate) fn show(&mut self) {
        self.visible = true;
        self.mode = PanelMode::Email;
        self.code.clear();
        self.challenge = None;
        self.resend_at = None;
        self.authorization = None;
        self.error = None;
        self.status = None;
        self.account_focus = AccountFocus::Close;
    }

    pub(crate) fn hide(&mut self) {
        self.visible = false;
        self.error = None;
        self.status = None;
    }

    pub(crate) fn show_account(
        &mut self,
        info: AccountInfo,
        identity: Option<AccountIdentityView>,
        devices: Vec<AccountDevice>,
    ) {
        self.visible = true;
        self.mode = PanelMode::Account;
        self.account_info = Some(info);
        self.identity = identity;
        self.devices = devices;
        self.account_focus = AccountFocus::Close;
        self.error = None;
        self.status = None;
    }

    pub(crate) fn set_error(&mut self, message: impl Into<String>) {
        self.error = Some(message.into());
        self.status = None;
    }

    pub(crate) fn set_status(&mut self, message: impl Into<String>) {
        self.status = Some(message.into());
        self.error = None;
    }

    pub(crate) fn set_authorization(&mut self, authorization: GitHubAuthStart) {
        self.mode = PanelMode::GitHub;
        self.authorization = Some(authorization);
        self.set_status("Complete the GitHub sign-in in your browser, then press Enter.");
    }

    /// A code was sent: the code field takes over.
    pub(crate) fn set_challenge(&mut self, challenge: AccountEmailChallenge) {
        self.mode = PanelMode::Code;
        self.code.clear();
        self.resend_at = Some(
            std::time::Instant::now()
                + std::time::Duration::from_secs(u64::from(challenge.retry_after_seconds)),
        );
        self.challenge = Some(challenge);
        self.error = None;
        self.status = None;
    }

    fn resend_wait(&self) -> u64 {
        self.resend_at
            .map(|at| at.saturating_duration_since(std::time::Instant::now()))
            .map(|left| left.as_secs() + u64::from(left.subsec_nanos() > 0))
            .unwrap_or(0)
    }

    fn code_length(&self) -> usize {
        self.challenge
            .as_ref()
            .map(|challenge| challenge.code_length as usize)
            .filter(|length| *length > 0)
            .unwrap_or(8)
    }

    pub(crate) fn insert_paste(&mut self, text: &str) {
        match self.mode {
            PanelMode::Email => self.email.extend(
                text.chars()
                    .filter(|c| !c.is_whitespace() && !c.is_control()),
            ),
            PanelMode::Code => {
                let length = self.code_length();
                for c in text.chars().filter(char::is_ascii_alphanumeric) {
                    if self.code.len() < length {
                        self.code.push(c);
                    }
                }
            }
            _ => {}
        }
    }

    pub(crate) fn handle_key_event(&mut self, key: KeyEvent) -> LoginFormAction {
        if !self.visible {
            return LoginFormAction::None;
        }
        match self.mode {
            PanelMode::Email => self.handle_email_key(key),
            PanelMode::Code => self.handle_code_key(key),
            PanelMode::GitHub => self.handle_github_key(key),
            PanelMode::Account => self.handle_account_key(key),
        }
    }

    fn handle_email_key(&mut self, key: KeyEvent) -> LoginFormAction {
        match key.code {
            KeyCode::Esc => {
                self.hide();
                LoginFormAction::Cancel
            }
            KeyCode::Enter if !self.email.trim().is_empty() => {
                LoginFormAction::SendCode(self.email.trim().to_string())
            }
            KeyCode::Tab => LoginFormAction::GitHub(None),
            KeyCode::Backspace => {
                self.email.pop();
                LoginFormAction::None
            }
            KeyCode::Char(c)
                if !key.modifiers.contains(KeyModifiers::CONTROL)
                    && !c.is_whitespace()
                    && self.email.len() < 254 =>
            {
                self.email.push(c);
                LoginFormAction::None
            }
            _ => LoginFormAction::None,
        }
    }

    fn handle_code_key(&mut self, key: KeyEvent) -> LoginFormAction {
        match key.code {
            // Back to the email field (another address).
            KeyCode::Esc => {
                self.mode = PanelMode::Email;
                self.code.clear();
                self.challenge = None;
                self.error = None;
                self.status = None;
                LoginFormAction::None
            }
            KeyCode::Enter if !self.code.is_empty() => match self.challenge.as_ref() {
                Some(challenge) => LoginFormAction::VerifyCode {
                    challenge_id: challenge.challenge_id.clone(),
                    code: self.code.clone(),
                },
                None => LoginFormAction::None,
            },
            KeyCode::Char('r') if key.modifiers.contains(KeyModifiers::CONTROL) => {
                match self.challenge.as_ref() {
                    Some(challenge) if self.resend_wait() == 0 => {
                        LoginFormAction::SendCode(challenge.email.clone())
                    }
                    _ => LoginFormAction::None,
                }
            }
            KeyCode::Backspace => {
                self.code.pop();
                LoginFormAction::None
            }
            KeyCode::Char(c)
                if c.is_ascii_alphanumeric() && self.code.len() < self.code_length() =>
            {
                self.code.push(c);
                LoginFormAction::None
            }
            _ => LoginFormAction::None,
        }
    }

    fn handle_github_key(&mut self, key: KeyEvent) -> LoginFormAction {
        match key.code {
            KeyCode::Esc => {
                self.mode = PanelMode::Email;
                self.authorization = None;
                self.error = None;
                self.status = None;
                LoginFormAction::None
            }
            KeyCode::Enter => LoginFormAction::GitHub(
                self.authorization
                    .as_ref()
                    .map(|a| a.transaction_id.clone()),
            ),
            KeyCode::Char('r') => {
                self.authorization = None;
                LoginFormAction::GitHub(None)
            }
            _ => LoginFormAction::None,
        }
    }

    fn handle_account_key(&mut self, key: KeyEvent) -> LoginFormAction {
        match (key.code, key.modifiers) {
            (KeyCode::Esc, _) => {
                self.hide();
                LoginFormAction::Cancel
            }
            (KeyCode::Up, _) | (KeyCode::BackTab, _) | (KeyCode::Left, _) => {
                self.account_focus = match self.account_focus {
                    AccountFocus::Logout => AccountFocus::Close,
                    AccountFocus::Close => AccountFocus::Logout,
                };
                LoginFormAction::None
            }
            (KeyCode::Down, _) | (KeyCode::Tab, _) | (KeyCode::Right, _) => {
                self.account_focus = match self.account_focus {
                    AccountFocus::Logout => AccountFocus::Close,
                    AccountFocus::Close => AccountFocus::Logout,
                };
                LoginFormAction::None
            }
            (KeyCode::Enter, _) => match self.account_focus {
                AccountFocus::Logout => LoginFormAction::Logout,
                AccountFocus::Close => {
                    self.hide();
                    LoginFormAction::Cancel
                }
            },
            _ => LoginFormAction::None,
        }
    }

    pub(crate) fn render(&self, frame: &mut Frame, area: Rect, theme: &Theme) {
        if !self.visible {
            return;
        }
        frame.render_widget(Clear, area);
        match self.mode {
            PanelMode::Account => self.render_account(frame, area, theme),
            _ => self.render_login(frame, area, theme),
        }
    }

    fn render_login(&self, frame: &mut Frame, area: Rect, theme: &Theme) {
        let outer = Block::default()
            .borders(Borders::ALL)
            .border_style(theme.style(StyleKind::Primary))
            .title(" OpenBitFun · Account Sign-in ")
            .title_alignment(Alignment::Center);
        let inner = outer.inner(area);
        frame.render_widget(outer, area);
        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(2),
                Constraint::Min(3),
                Constraint::Length(2),
                Constraint::Length(1),
            ])
            .split(inner);
        let intro = match self.mode {
            PanelMode::Code => format!(
                "Enter the code we sent to {}.",
                self.challenge
                    .as_ref()
                    .map(|challenge| challenge.email.as_str())
                    .unwrap_or_default()
            ),
            PanelMode::GitHub => "Sign in with GitHub in your browser.".to_string(),
            _ => "Sign in with your email. We'll send you a code; no password needed.".to_string(),
        };
        frame.render_widget(
            Paragraph::new(intro)
                .style(theme.style(StyleKind::Muted))
                .wrap(Wrap { trim: false }),
            rows[0],
        );
        let field = |label: &str, value: &str, placeholder: String| {
            let shown = if value.is_empty() {
                Span::styled(placeholder, theme.style(StyleKind::Muted))
            } else {
                Span::styled(
                    format!("{value}▏"),
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                )
            };
            Paragraph::new(Line::from(vec![
                Span::styled(format!("{label}: "), theme.style(StyleKind::Muted)),
                shown,
            ]))
        };
        let body = match self.mode {
            PanelMode::Code => field("Code", &self.code, "0".repeat(self.code_length())),
            PanelMode::GitHub => Paragraph::new(
                self.authorization
                    .as_ref()
                    .map(|a| format!("Open this link in your browser:\n\n{}", a.authorization_url))
                    .unwrap_or_default(),
            )
            .style(theme.style(StyleKind::Primary))
            .wrap(Wrap { trim: false }),
            _ => field("Email", &self.email, "you@example.com".to_string()),
        };
        frame.render_widget(body, rows[1]);
        self.render_message(frame, rows[2], theme);
        let hints = match self.mode {
            PanelMode::Code => match self.resend_wait() {
                0 => "Enter Sign in   Ctrl+R Send again   Esc Other email".to_string(),
                wait => format!("Enter Sign in   Send again in {wait}s   Esc Other email"),
            },
            PanelMode::GitHub => "Enter Check   R Restart   Esc Back".to_string(),
            _ => "Enter Send code   Tab Sign in with GitHub   Esc Close".to_string(),
        };
        self.render_hints(frame, rows[3], &hints, theme);
    }

    fn render_account(&self, frame: &mut Frame, area: Rect, theme: &Theme) {
        let outer = Block::default()
            .borders(Borders::ALL)
            .border_style(theme.style(StyleKind::Primary))
            .title(" OpenBitFun Account ")
            .title_alignment(Alignment::Center);
        let inner = outer.inner(area);
        frame.render_widget(outer, area);

        let rows = Layout::default()
            .direction(Direction::Vertical)
            .constraints([
                Constraint::Length(4), // account info
                Constraint::Min(4),    // devices
                Constraint::Length(1), // buttons
                Constraint::Length(1), // hints
            ])
            .split(inner);

        let info = self.account_info.as_ref();
        let info_lines = vec![
            Line::from(vec![
                Span::styled("Signed in as: ", theme.style(StyleKind::Muted)),
                Span::styled(
                    self.identity
                        .as_ref()
                        .map(|identity| identity.display_name.as_str())
                        .unwrap_or("-"),
                    Style::default()
                        .fg(Color::White)
                        .add_modifier(Modifier::BOLD),
                ),
            ]),
            Line::from(vec![
                Span::styled("Auth Server: ", theme.style(StyleKind::Muted)),
                Span::styled(
                    info.map(|i| i.relay_url.as_str()).unwrap_or("-"),
                    Style::default().fg(Color::White),
                ),
            ]),
            Line::from(vec![
                Span::styled("This device: ", theme.style(StyleKind::Muted)),
                Span::styled(
                    info.map(|i| i.device_name.as_str()).unwrap_or("-"),
                    Style::default().fg(Color::White),
                ),
                Span::styled(
                    format!(
                        "  ({})",
                        info.map(|i| truncate_id(&i.device_id))
                            .unwrap_or_else(|| "-".into())
                    ),
                    theme.style(StyleKind::Muted),
                ),
            ]),
        ];
        frame.render_widget(Paragraph::new(info_lines), rows[0]);

        let mut device_lines = vec![Line::from(Span::styled(
            "Devices",
            theme.style(StyleKind::Primary).add_modifier(Modifier::BOLD),
        ))];
        if self.devices.is_empty() {
            device_lines.push(Line::from(Span::styled(
                "  (no devices listed yet)",
                theme.style(StyleKind::Muted),
            )));
        } else {
            let local_id = info.map(|i| i.device_id.as_str());
            for d in &self.devices {
                let is_local = local_id == Some(d.device_id.as_str());
                let status = if d.online { "online" } else { "offline" };
                let badge = if is_local { " [this device]" } else { "" };
                // A missing flag (older account service) is unknown and shows nothing.
                let compat = if d.is_compatible() {
                    ""
                } else {
                    "  · incompatible"
                };
                device_lines.push(Line::from(Span::styled(
                    format!(
                        "  {}{}  {}  · {}{}  {}",
                        d.display_name(),
                        badge,
                        truncate_id(&d.device_id),
                        status,
                        compat,
                        [
                            d.device_model.as_deref(),
                            d.device_os.as_deref(),
                            d.device_os_version.as_deref()
                        ]
                        .into_iter()
                        .flatten()
                        .collect::<Vec<_>>()
                        .join(" ")
                    ),
                    if d.online {
                        Style::default().fg(Color::White)
                    } else {
                        theme.style(StyleKind::Muted)
                    },
                )));
            }
        }
        frame.render_widget(Paragraph::new(device_lines), rows[1]);

        let btn_row = Layout::default()
            .direction(Direction::Horizontal)
            .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
            .split(rows[2]);
        self.render_button(
            frame,
            btn_row[0],
            "[ Logout ]",
            self.account_focus == AccountFocus::Logout,
            theme,
        );
        self.render_button(
            frame,
            btn_row[1],
            "[ Close ]",
            self.account_focus == AccountFocus::Close,
            theme,
        );
        self.render_hints(
            frame,
            rows[3],
            "Tab Switch   Enter Activate   Esc Close",
            theme,
        );
    }

    fn render_button(
        &self,
        frame: &mut Frame,
        area: Rect,
        label: &str,
        active: bool,
        theme: &Theme,
    ) {
        let style = if active {
            Style::default()
                .bg(theme.primary)
                .fg(theme.selection_foreground())
                .add_modifier(Modifier::BOLD)
        } else {
            theme.style(StyleKind::Muted)
        };
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(label, style))).alignment(Alignment::Center),
            area,
        );
    }

    fn render_message(&self, frame: &mut Frame, area: Rect, theme: &Theme) {
        // The error may carry a second guidance line; keep it on its own row.
        let (message, style) = if let Some(ref err) = self.error {
            (err.as_str(), theme.style(StyleKind::Error))
        } else if let Some(ref status) = self.status {
            (status.as_str(), theme.style(StyleKind::Info))
        } else {
            return;
        };
        let lines: Vec<Line> = message
            .lines()
            .map(|line| Line::from(Span::styled(line.to_string(), style)))
            .collect();
        frame.render_widget(Paragraph::new(lines).alignment(Alignment::Center), area);
    }

    fn render_hints(&self, frame: &mut Frame, area: Rect, hints: &str, theme: &Theme) {
        frame.render_widget(
            Paragraph::new(Line::from(Span::styled(
                hints,
                theme.style(StyleKind::Muted),
            )))
            .alignment(Alignment::Center),
            area,
        );
    }
}

fn truncate_id(id: &str) -> String {
    if id.len() <= 8 {
        id.to_string()
    } else {
        format!("{}…", id.chars().take(8).collect::<String>())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn truncate_id_handles_multibyte_ids() {
        assert_eq!(truncate_id(&"中".repeat(9)), format!("{}…", "中".repeat(8)));
    }

    fn key(code: KeyCode) -> KeyEvent {
        KeyEvent::new(code, KeyModifiers::NONE)
    }

    #[test]
    fn email_then_code_signs_in_without_a_browser() {
        let mut form = LoginFormState::new();
        form.show();
        assert!(matches!(
            form.handle_key_event(key(KeyCode::Enter)),
            LoginFormAction::None
        ));
        form.insert_paste(" a@example.com ");
        assert!(
            matches!(form.handle_key_event(key(KeyCode::Enter)), LoginFormAction::SendCode(email) if email == "a@example.com")
        );
        form.set_challenge(AccountEmailChallenge {
            challenge_id: "c1".into(),
            email: "a@example.com".into(),
            code_length: 8,
            retry_after_seconds: 60,
            expires_at: None,
        });
        for c in "0123 456789".chars() {
            form.handle_key_event(key(KeyCode::Char(c)));
        }
        assert_eq!(form.code, "01234567", "digits only, up to the code length");
        // Another code waits for the retry-after.
        assert!(matches!(
            form.handle_key_event(KeyEvent::new(KeyCode::Char('r'), KeyModifiers::CONTROL)),
            LoginFormAction::None
        ));
        assert!(
            matches!(form.handle_key_event(key(KeyCode::Enter)), LoginFormAction::VerifyCode { challenge_id, code } if challenge_id == "c1" && code == "01234567")
        );
        // Esc on the code goes back to the email, not out of the panel.
        assert!(matches!(
            form.handle_key_event(key(KeyCode::Esc)),
            LoginFormAction::None
        ));
        assert!(form.is_visible());
        assert_eq!(form.mode, PanelMode::Email);
    }

    #[test]
    fn the_account_page_shows_the_identity_display_name() {
        let mut form = LoginFormState::new();
        form.show_account(
            AccountInfo {
                user_id: "email-7".into(),
                relay_url: "https://r".into(),
                device_id: "d".into(),
                device_name: "Mac".into(),
            },
            AccountIdentityView::from_parts(
                "email-7",
                Some("a@example.com"),
                Some("user-87b5"),
                None,
            ),
            Vec::new(),
        );
        let backend = ratatui::backend::TestBackend::new(80, 16);
        let mut terminal = ratatui::Terminal::new(backend).unwrap();
        terminal
            .draw(|frame| form.render(frame, frame.area(), &Theme::dark()))
            .unwrap();
        let shown: String = terminal
            .backend()
            .buffer()
            .content()
            .iter()
            .map(|cell| cell.symbol())
            .collect();
        assert!(shown.contains("a@example.com"), "{shown}");
        assert!(
            !shown.contains("user-87b5") && !shown.contains("email-7"),
            "{shown}"
        );
    }

    #[test]
    fn tab_starts_or_checks_the_github_browser_sign_in() {
        let mut form = LoginFormState::new();
        form.show();
        assert!(matches!(
            form.handle_key_event(key(KeyCode::Tab)),
            LoginFormAction::GitHub(None)
        ));
        form.set_authorization(GitHubAuthStart {
            transaction_id: "txn".into(),
            authorization_url: "https://github.com/login/oauth/authorize".into(),
            expires_at: 99,
            poll_interval_seconds: 3,
        });
        assert!(
            matches!(form.handle_key_event(key(KeyCode::Enter)), LoginFormAction::GitHub(Some(id)) if id == "txn")
        );
        // Esc goes back to the email sign-in; Esc there closes the panel.
        assert!(matches!(
            form.handle_key_event(key(KeyCode::Esc)),
            LoginFormAction::None
        ));
        assert!(matches!(
            form.handle_key_event(key(KeyCode::Esc)),
            LoginFormAction::Cancel
        ));
    }
}
