import React from 'react';
import { Menu } from 'lucide-react';
import { resolveMessage, type I18NCatalog } from '../../api/i18n';
import { SSRP_I18N_KEYS, SSRP_TEXT_FALLBACK_JA } from '../../constants/i18n';

interface HamburgerMenuProps {
    onClick: () => void;
    isOpen: boolean; // アイコンの変化などに使う場合
    uiCatalog: I18NCatalog | null;
}

export const HamburgerMenu: React.FC<HamburgerMenuProps> = ({ onClick, uiCatalog }) => {
    const t = (key: string) => resolveMessage(uiCatalog, key, SSRP_TEXT_FALLBACK_JA[key] || key);

    return (
        <button
            onClick={onClick}
            className="p-2 hover:bg-gray-800 rounded-full text-gray-400 hover:text-purple-400 transition-colors"
            title={t(SSRP_I18N_KEYS.menuTitle)}
        >
            <Menu size={20} />
        </button>
    );
};
