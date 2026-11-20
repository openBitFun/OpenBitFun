// Build-time style projection only: no React components or product runtime.
import launcher from '../../../../design-system/packages/ui/src/components/LauncherButton/LauncherButton.module.css';
import iconButton from '../../../../design-system/packages/ui/src/components/IconButton/IconButton.module.css';
import composer from '../../../../design-system/packages/ui/src/flow-chat/composer/ChatComposer.module.css';
// The Hi/FlowChat stylesheets below are owned here since the React desktop UI
// (their former owner) was retired; the native MiniApp shell is their only consumer.
import './floating-mini-chat.scss';
import './chat-input.scss';
import './flow-text-block.scss';
import './user-message-item.scss';
import './model-round-item.scss';
import './chat-layout.scss';

export { launcher, iconButton, composer };
