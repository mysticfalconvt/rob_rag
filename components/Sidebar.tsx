'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Sidebar.module.css';

export default function Sidebar() {
    const pathname = usePathname();

    const isActive = (path: string) => pathname === path;

    return (
        <aside className={styles.sidebar}>
            <div className={styles.logo}>
                <i className="fas fa-robot"></i>
                <span>RobRAG</span>
            </div>

            <nav className={styles.nav}>
                <Link href="/" className={`${styles.link} ${isActive('/') ? styles.active : ''}`}>
                    <i className="fas fa-comments"></i>
                    <span>Chat</span>
                </Link>

                <Link href="/files" className={`${styles.link} ${isActive('/files') ? styles.active : ''}`}>
                    <i className="fas fa-folder-open"></i>
                    <span>Files</span>
                </Link>

                <Link href="/status" className={`${styles.link} ${isActive('/status') ? styles.active : ''}`}>
                    <i className="fas fa-server"></i>
                    <span>Status</span>
                </Link>
            </nav>

            <div className={styles.footer}>
                <p>v0.1.0</p>
            </div>
        </aside>
    );
}
