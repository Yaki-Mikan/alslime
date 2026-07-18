import React, { useEffect, useState } from 'react';
import { X, Copy, Check } from 'lucide-react';
import axios from '../lib/axios';

interface CodeViewerProps {
    filePath: string;
    onClose: () => void;
    backendUrl: string;
}

export const CodeViewer: React.FC<CodeViewerProps> = ({ filePath, onClose, backendUrl }) => {
    const [content, setContent] = useState('');
    const [loading, setLoading] = useState(true);
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const loadContent = async () => {
            try {
                const res = await axios.get(`${backendUrl}/api/content?path=${encodeURIComponent(filePath)}`);
                setContent(res.data.content);
            } catch (error) {
                setContent("Error loading file content.");
            } finally {
                setLoading(false);
            }
        };
        loadContent();
    }, [filePath, backendUrl]);

    const handleCopy = () => {
        navigator.clipboard.writeText(content);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <div className="bg-gray-900 rounded-lg shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col border border-gray-700 overflow-hidden animate-in fade-in zoom-in duration-200">

                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700 bg-gray-800">
                    <h3 className="font-mono text-sm text-gray-200 truncate">{filePath}</h3>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleCopy}
                            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white transition-colors"
                            title="Copy content"
                        >
                            {copied ? <Check size={18} className="text-green-400" /> : <Copy size={18} />}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 hover:bg-red-500/20 hover:text-red-400 rounded text-gray-400 transition-colors"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-4 bg-[#1e1e1e] font-mono text-sm leading-relaxed text-gray-300">
                    {loading ? (
                        <div className="flex items-center justify-center h-full text-gray-500 animate-pulse">
                            Loading content...
                        </div>
                    ) : (
                        <pre className="whitespace-pre-wrap break-all">
                            {content || <span className="text-gray-600 italic">Empty file</span>}
                        </pre>
                    )}
                </div>
            </div>
        </div>
    );
};
