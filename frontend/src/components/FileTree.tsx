import React, { useState, useEffect } from 'react';
import { ChevronRight, ChevronDown, File, Folder } from 'lucide-react';
import axios from '../lib/axios';

interface FileNode {
    name: string;
    isDirectory: boolean;
    path: string;
}

interface FileTreeProps {
    currentPath?: string;
    onSelectFile: (path: string) => void;
    backendUrl: string;
    multiSelect?: boolean;  // 複数選択モード
    selectedPaths?: string[];  // 選択中のパス
}

const FileTreeNode: React.FC<{
    node: FileNode;
    backendUrl: string;
    level: number;
    onSelectFile: (path: string) => void;
    multiSelect?: boolean;
    selectedPaths?: string[];
}> = ({ node, backendUrl, level, onSelectFile, multiSelect, selectedPaths = [] }) => {
    const [isOpen, setIsOpen] = useState(false);
    const [children, setChildren] = useState<FileNode[]>([]);
    const [loading, setLoading] = useState(false);

    const isSelected = selectedPaths.includes(node.path);

    const toggleOpen = async () => {
        if (!node.isDirectory) {
            onSelectFile(node.path);
            return;
        }

        if (isOpen) {
            setIsOpen(false);
            return;
        }

        setIsOpen(true);
        if (children.length === 0) {
            setLoading(true);
            try {
                const res = await axios.get(`${backendUrl}/api/files?path=${encodeURIComponent(node.path)}`);
                setChildren(res.data.files);
            } catch (error) {
                console.error("Failed to load files", error);
            } finally {
                setLoading(false);
            }
        }
    };

    return (
        <div style={{ paddingLeft: `${level * 12}px` }}>
            <div
                className={`flex items-center gap-1 py-1 px-2 hover:bg-gray-700 cursor-pointer rounded text-sm ${!node.isDirectory ? 'text-gray-300' : 'text-blue-200 font-medium'
                    } ${isSelected ? 'bg-blue-600/30 border-l-2 border-blue-400' : ''}`}
                onClick={toggleOpen}
            >
                {node.isDirectory && (
                    <span className="text-gray-400">
                        {isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                    </span>
                )}
                {!node.isDirectory && <File size={14} className="ml-4 text-gray-500" />}
                {node.isDirectory && <Folder size={14} className="text-blue-400" />}
                <span className="truncate">{node.name}</span>
                {isSelected && <span className="ml-auto text-blue-400 text-xs">✓</span>}
            </div>
            {isOpen && (
                <div>
                    {loading ? (
                        <div className="pl-6 text-xs text-gray-500 py-1">Loading...</div>
                    ) : (
                        children.map((child) => (
                            <FileTreeNode
                                key={child.path}
                                node={child}
                                backendUrl={backendUrl}
                                level={level + 1}
                                onSelectFile={onSelectFile}
                                multiSelect={multiSelect}
                                selectedPaths={selectedPaths}
                            />
                        ))
                    )}
                </div>
            )}
        </div>
    );
};

export const FileTree: React.FC<FileTreeProps> = ({ currentPath: _currentPath, onSelectFile, backendUrl, multiSelect, selectedPaths }) => {
    const [roots, setRoots] = useState<FileNode[]>([]);

    useEffect(() => {
        const loadRoot = async () => {
            try {
                const res = await axios.get(`${backendUrl}/api/files`);
                setRoots(res.data.files);
            } catch (error) {
                console.error("Failed to load root files", error);
            }
        };
        loadRoot();
    }, [backendUrl]);

    return (
        <div className="overflow-x-hidden">
            {roots.map(node => (
                <FileTreeNode
                    key={node.path}
                    node={node}
                    backendUrl={backendUrl}
                    level={0}
                    onSelectFile={onSelectFile}
                    multiSelect={multiSelect}
                    selectedPaths={selectedPaths}
                />
            ))}
        </div>
    );
};
