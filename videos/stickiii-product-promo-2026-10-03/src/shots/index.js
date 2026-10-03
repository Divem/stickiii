import {Hook,Capture,Markdown,Windows,Themes,Ai,Feishu,Close,build} from './product-film.jsx';
export const SHOT_VIEWS={hook:Hook,capture:Capture,markdown:Markdown,windows:Windows,themes:Themes,ai:Ai,feishu:Feishu,close:Close};
export const SHOT_BUILDERS=Object.fromEntries(Object.keys(SHOT_VIEWS).map(id=>[id,build(id)]));
