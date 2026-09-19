// ============================================
// STATE MANAGEMENT
// ============================================
const state = {
    connected: false,
    address: null,
    chainId: 11155111,
    currentPage: 'marketplace',
    theme: 'dark',
    currentListing: null,
    currentTrade: null,
    listings: [
        {
            id: 1,
            seller: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
            arbiter: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
            token: 'USDC',
            tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
            bondAmount: '500',
            totalAmount: '5000',
            milestoneAmounts: ['1500', '2000', '1500'],
            milestoneTitles: ['Design & Architecture', 'Development', 'Deployment & Testing'],
            status: 'Active',
            createdAt: Date.now() - 86400000 * 2,
            description: 'Full-stack web application development with milestone-based payments'
        },
        {
            id: 2,
            seller: '0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE',
            arbiter: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
            token: 'USDC',
            tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
            bondAmount: '1000',
            totalAmount: '12000',
            milestoneAmounts: ['4000', '4000', '4000'],
            milestoneTitles: ['Property Inspection', 'Title Transfer', 'Final Closing'],
            status: 'Active',
            createdAt: Date.now() - 86400000 * 5,
            description: 'Real estate transaction with title verification and escrow'
        },
        {
            id: 3,
            seller: '0x9aE6b0E2f1C8d3A4B5c6D7e8F9a0B1c2D3e4F5a6',
            arbiter: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
            token: 'USDT',
            tokenAddress: '0xaA8E23Fb1079EA71e0a56F48a2aA51851D8433D0',
            bondAmount: '250',
            totalAmount: '2500',
            milestoneAmounts: ['1000', '1500'],
            milestoneTitles: ['Initial Consultation', 'Full Service Delivery'],
            status: 'Sold',
            createdAt: Date.now() - 86400000 * 7,
            description: 'Legal consulting services with compliance verification'
        }
    ],
    trades: [
        {
            id: 1,
            listingId: 1,
            vault: '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
            buyer: '0x1aD91ee08f21bE016D6E5b4B8C4a5B6C7D8E9F0A',
            seller: '0x742d35Cc6634C0532925a3b8D4C9db96C4b4d8b6',
            arbiter: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
            token: 'USDC',
            totalAmount: '5000',
            bondAmount: '500',
            milestones: [
                { index: 0, title: 'Design & Architecture', amount: '1500', status: 'Released', docHash: '0x8a3e2f1c9d4b5a6e7f8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a', confirmedAt: Date.now() - 86400000 },
                { index: 1, title: 'Development', amount: '2000', status: 'DocsSubmitted', docHash: '0x4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c', submittedAt: Date.now() - 3600000 },
                { index: 2, title: 'Deployment & Testing', amount: '1500', status: 'Pending', docHash: null }
            ],
            status: 'Active',
            funded: true,
            bondDeposited: true,
            createdAt: Date.now() - 86400000 * 2
        },
        {
            id: 2,
            listingId: 2,
            vault: '0x6B7C8D9E0F1A2B3C4D5E6F7A8B9C0D1E2F3A4B5',
            buyer: '0x1aD91ee08f21bE016D6E5b4B8C4a5B6C7D8E9F0A',
            seller: '0x3f5CE5FBFe3E9af3971dD833D26bA9b5C936f0bE',
            arbiter: '0x8ba1f109551bD432803012645Ac136ddd64DBA72',
            token: 'USDC',
            totalAmount: '12000',
            bondAmount: '1000',
            milestones: [
                { index: 0, title: 'Property Inspection', amount: '4000', status: 'Disputed', docHash: '0x1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b', disputeReason: 'Inspection report does not match property condition. Multiple issues found with foundation not disclosed in initial assessment.', disputedBy: '0x1aD91ee08f21bE016D6E5b4B8C4a5B6C7D8E9F0A', disputedAt: Date.now() - 7200000 },
                { index: 1, title: 'Title Transfer', amount: '4000', status: 'Pending', docHash: null },
                { index: 2, title: 'Final Closing', amount: '4000', status: 'Pending', docHash: null }
            ],
            status: 'Active',
            funded: true,
            bondDeposited: true,
            createdAt: Date.now() - 86400000 * 3
        }
    ],
    compliance: {
        tier: 0,
        currentVolume: 3500,
        tier0Cap: 1000,
        tier1Cap: 10000,
        verified: false
    }
};

// ============================================
// UTILITY FUNCTIONS
// ============================================
function truncateAddress(addr, start = 6, end = 4) {
    if (!addr) return '';
    return `${addr.slice(0, start)}...${addr.slice(-end)}`;
}

function copyToClipboard(text, btn) {
    navigator.clipboard.writeText(text);
    if (btn) {
        btn.classList.add('copied');
        setTimeout(() => btn.classList.remove('copied'), 1500);
    }
    showToast('Copied to clipboard', 'success');
}

function formatAmount(amount, decimals = 2) {
    return parseFloat(amount).toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

function timeAgo(timestamp) {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
}

function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    const colors = {
        success: 'bg-success-600 border-success-500',
        error: 'bg-danger-600 border-danger-500',
        warning: 'bg-warning-600 border-warning-500',
        info: 'bg-trust-600 border-trust-500'
    };
    toast.className = `px-4 py-3 rounded-lg border text-white text-sm font-medium fade-in ${colors[type]}`;
    toast.textContent = message;
    container.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = '0';
        toast.style.transform = 'translateX(100%)';
        setTimeout(() => toast.remove(), 300);
    }, 3000);
}

// ============================================
// THEME & WALLET
// ============================================
function toggleTheme() {
    const html = document.documentElement;
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    html.classList.toggle('dark', state.theme === 'dark');
}

function toggleWalletModal() {
    document.getElementById('wallet-modal').classList.toggle('hidden');
}

function connectWallet(provider) {
    state.connected = true;
    state.address = '0x1aD91ee08f21bE016D6E5b4B8C4a5B6C7D8E9F0A';
    toggleWalletModal();
    updateConnectButton();
    showToast('Wallet connected', 'success');
    renderPage();
}

function disconnectWallet() {
    state.connected = false;
    state.address = null;
    updateConnectButton();
    renderPage();
}

function updateConnectButton() {
    const btn = document.querySelector('[onclick="toggleWalletModal()"]');
    if (state.connected) {
        btn.innerHTML = `<div class="flex items-center gap-2"><div class="w-2 h-2 rounded-full bg-success-500"></div><span class="font-mono text-sm">${truncateAddress(state.address)}</span></div>`;
        btn.onclick = disconnectWallet;
    } else {
        btn.innerHTML = 'Connect Wallet';
        btn.onclick = toggleWalletModal;
    }
}

// ============================================
// TRANSACTION MODAL
// ============================================
function showTxModal(type, message = '') {
    const modal = document.getElementById('tx-modal');
    modal.classList.remove('hidden');
    document.getElementById('tx-loading').classList.toggle('hidden', type !== 'loading');
    document.getElementById('tx-success').classList.toggle('hidden', type !== 'success');
    document.getElementById('tx-error').classList.toggle('hidden', type !== 'error');
    if (message) {
        document.getElementById('tx-success-msg').textContent = message;
        document.getElementById('tx-error-msg').textContent = message;
    }
}

function closeTxModal() {
    document.getElementById('tx-modal').classList.add('hidden');
}

function simulateTx(success = true, message = '') {
    showTxModal('loading');
    setTimeout(() => {
        showTxModal(success ? 'success' : 'error', message);
        if (success) renderPage();
    }, 2000);
}

// ============================================
// STATUS COMPONENTS
// ============================================
function StatusBadge(status, size = 'md') {
    const configs = {
        'Pending': { color: 'bg-ink-700 text-ink-300 border-ink-600', dot: 'bg-ink-400', label: 'Pending' },
        'DocsSubmitted': { color: 'bg-trust-500/20 text-trust-400 border-trust-500/30', dot: 'bg-trust-400 animate-pulse-subtle', label: 'Docs Submitted' },
        'Released': { color: 'bg-success-500/20 text-success-400 border-success-500/30', dot: 'bg-success-400', label: 'Released' },
        'Disputed': { color: 'bg-danger-500/20 text-danger-400 border-danger-500/30', dot: 'bg-danger-400', label: 'Disputed' },
        'Refunded': { color: 'bg-warning-500/20 text-warning-400 border-warning-500/30', dot: 'bg-warning-400', label: 'Refunded' },
        'Active': { color: 'bg-success-500/20 text-success-400 border-success-500/30', dot: 'bg-success-400', label: 'Active' },
        'Cancelled': { color: 'bg-ink-700 text-ink-400 border-ink-600', dot: 'bg-ink-500', label: 'Cancelled' },
        'Sold': { color: 'bg-trust-500/20 text-trust-400 border-trust-500/30', dot: 'bg-trust-400', label: 'Sold' },
        'Funded': { color: 'bg-trust-500/20 text-trust-400 border-trust-500/30', dot: 'bg-trust-400', label: 'Funded' },
        'Completed': { color: 'bg-success-500/20 text-success-400 border-success-500/30', dot: 'bg-success-400', label: 'Completed' },
    };
    const config = configs[status] || configs['Pending'];
    const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-3 py-1 text-sm';
    return `<span class="inline-flex items-center gap-1.5 rounded-full border font-medium ${config.color} ${sizeClasses}"><span class="w-1.5 h-1.5 rounded-full ${config.dot}"></span>${config.label}</span>`;
}

function VerificationBadge(tier, verified) {
    if (!verified) {
        return `<span class="inline-flex items-center gap-1.5 rounded-full border border-ink-600 bg-ink-800 px-3 py-1 text-sm text-ink-400"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/></svg>Tier ${tier} — Unverified</span>`;
    }
    const colors = ['bg-ink-700 text-ink-300', 'bg-trust-500/20 text-trust-400 border-trust-500/30', 'bg-success-500/20 text-success-400 border-success-500/30'];
    return `<span class="inline-flex items-center gap-1.5 rounded-full border font-medium ${colors[tier]} px-3 py-1 text-sm"><svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>Tier ${tier} — Verified</span>`;
}

function RoleBadge(role) {
    const colors = {
        buyer: 'bg-trust-500/20 text-trust-400 border-trust-500/30',
        seller: 'bg-success-500/20 text-success-400 border-success-500/30',
        arbiter: 'bg-warning-500/20 text-warning-400 border-warning-500/30',
        viewer: 'bg-ink-700 text-ink-400 border-ink-600'
    };
    return `<span class="inline-flex items-center gap-1.5 rounded-full border font-medium ${colors[role]} px-3 py-1 text-sm capitalize">${role}</span>`;
}

// ============================================
// PAGE RENDERING
// ============================================
function showPage(page) {
    state.currentPage = page;
    document.querySelectorAll('.nav-link').forEach(link => {
        const isActive = link.dataset.page === page;
        link.classList.toggle('text-white', isActive);
        link.classList.toggle('bg-ink-800', isActive);
        link.classList.toggle('text-ink-300', !isActive);
    });
    renderPage();
}

function renderPage() {
    const container = document.getElementById('page-container');
    container.innerHTML = '';
    switch (state.currentPage) {
        case 'marketplace': container.innerHTML = renderMarketplace(); break;
        case 'dashboard': container.innerHTML = renderDashboard(); break;
        case 'create': container.innerHTML = renderCreateListing(); break;
        case 'trade': container.innerHTML = renderTradeDetail(); break;
        case 'listing': container.innerHTML = renderListingDetail(); break;
    }
}

// ============================================
// MARKETPLACE PAGE
// ============================================
function renderMarketplace() {
    return `
        <div class="fade-in">
            <div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-8">
                <div>
                    <h1 class="text-2xl font-bold tracking-tight">Marketplace</h1>
                    <p class="text-ink-400 mt-1">Browse active escrow listings with milestone-based payments</p>
                </div>
                <button onclick="showPage('create')" class="btn-press px-4 py-2.5 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold glow-trust flex items-center gap-2">
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4"/>
                    </svg>
                    Create Listing
                </button>
            </div>
            <div class="flex flex-wrap items-center gap-3 mb-6 p-4 rounded-xl bg-ink-900 border border-ink-800">
                <div class="flex items-center gap-2">
                    <span class="text-sm text-ink-400">Status:</span>
                    <select class="bg-ink-800 border border-ink-700 rounded-lg px-3 py-1.5 text-sm text-ink-200 focus:outline-none focus:border-trust-500">
                        <option>All</option><option>Active</option><option>Sold</option><option>Cancelled</option>
                    </select>
                </div>
                <div class="flex items-center gap-2">
                    <span class="text-sm text-ink-400">Token:</span>
                    <select class="bg-ink-800 border border-ink-700 rounded-lg px-3 py-1.5 text-sm text-ink-200 focus:outline-none focus:border-trust-500">
                        <option>All</option><option>USDC</option><option>USDT</option><option>DAI</option>
                    </select>
                </div>
                <div class="flex items-center gap-2 flex-1 min-w-[200px]">
                    <svg class="w-4 h-4 text-ink-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/>
                    </svg>
                    <input type="text" placeholder="Search listings..." class="flex-1 bg-transparent text-sm text-ink-200 placeholder-ink-500 focus:outline-none">
                </div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                ${state.listings.map(listing => renderListingCard(listing)).join('')}
            </div>
        </div>
    `;
}

function renderListingCard(listing) {
    return `
        <div class="deal-card bg-ink-900 border border-ink-800 rounded-xl overflow-hidden cursor-pointer" onclick="viewListing(${listing.id})">
            <div class="p-5">
                <div class="flex items-start justify-between mb-4">
                    ${StatusBadge(listing.status)}
                    <span class="text-xs text-ink-500 font-mono">#${listing.id}</span>
                </div>
                <h3 class="font-semibold text-lg mb-2 line-clamp-2">${listing.description}</h3>
                <div class="flex items-center gap-2 mb-4">
                    <div class="w-6 h-6 rounded-full bg-gradient-to-br from-trust-500 to-trust-700 flex items-center justify-center text-xs font-bold text-white">
                        ${listing.seller.slice(2, 4).toUpperCase()}
                    </div>
                    <span class="addr text-ink-400">${truncateAddress(listing.seller)}</span>
                    <button onclick="event.stopPropagation(); copyToClipboard('${listing.seller}', this)" class="text-ink-500 hover:text-ink-300">
                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 012 2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                        </svg>
                    </button>
                </div>
                <div class="space-y-2 mb-4">
                    <div class="flex justify-between text-sm">
                        <span class="text-ink-400">Total Value</span>
                        <span class="font-semibold font-mono">${formatAmount(listing.totalAmount)} ${listing.token}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span class="text-ink-400">Seller Bond</span>
                        <span class="font-mono text-warning-400">${formatAmount(listing.bondAmount)} ${listing.token}</span>
                    </div>
                    <div class="flex justify-between text-sm">
                        <span class="text-ink-400">Milestones</span>
                        <span class="font-mono">${listing.milestoneAmounts.length}</span>
                    </div>
                </div>
                <div class="flex gap-1 mb-4">
                    ${listing.milestoneAmounts.map((amt, i) => `
                        <div class="flex-1 h-1.5 rounded-full bg-ink-700 overflow-hidden">
                            <div class="h-full bg-trust-500 rounded-full" style="width: ${listing.status === 'Sold' ? 100 : 0}%"></div>
                        </div>
                    `).join('')}
                </div>
                <div class="flex items-center justify-between pt-4 border-t border-ink-800">
                    <span class="text-xs text-ink-500">${timeAgo(listing.createdAt)}</span>
                    <button class="text-sm text-trust-400 hover:text-trust-300 font-medium">View Details →</button>
                </div>
            </div>
        </div>
    `;
}

// ============================================
// LISTING DETAIL PAGE
// ============================================
function viewListing(id) {
    state.currentListing = state.listings.find(l => l.id === id);
    showPage('listing');
}

function renderListingDetail() {
    const listing = state.currentListing || state.listings[0];
    const isSeller = state.address?.toLowerCase() === listing.seller.toLowerCase();
    const isArbiter = state.address?.toLowerCase() === listing.arbiter.toLowerCase();
    
    return `
        <div class="fade-in max-w-4xl mx-auto">
            <button onclick="showPage('marketplace')" class="flex items-center gap-2 text-ink-400 hover:text-white mb-6">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                </svg>
                Back to Marketplace
            </button>
            <div class="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div class="lg:col-span-2 space-y-6">
                    <div class="bg-ink-900 border border-ink-800 rounded-xl p-6">
                        <div class="flex items-start justify-between mb-4">
                            ${StatusBadge(listing.status)}
                            <span class="text-sm text-ink-500 font-mono">Listing #${listing.id}</span>
                        </div>
                        <h1 class="text-2xl font-bold mb-4">${listing.description}</h1>
                        <div class="grid grid-cols-2 gap-4 mb-6">
                            <div class="p-4 rounded-lg bg-ink-800/50 border border-ink-700">
                                <div class="text-xs text-ink-400 mb-1">Seller</div>
                                <div class="flex items-center gap-2">
                                    <span class="addr text-ink-200">${truncateAddress(listing.seller)}</span>
                                    <button onclick="copyToClipboard('${listing.seller}', this)" class="text-ink-500 hover:text-ink-300">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 012 2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                            <div class="p-4 rounded-lg bg-ink-800/50 border border-ink-700">
                                <div class="text-xs text-ink-400 mb-1">Arbiter</div>
                                <div class="flex items-center gap-2">
                                    <span class="addr text-ink-200">${truncateAddress(listing.arbiter)}</span>
                                    <button onclick="copyToClipboard('${listing.arbiter}', this)" class="text-ink-500 hover:text-ink-300">
                                        <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 012 2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"/>
                                        </svg>
                                    </button>
                                </div>
                            </div>
                        </div>
                        <h3 class="font-semibold mb-4">Milestones</h3>
                        <div class="space-y-3">
                            ${listing.milestoneAmounts.map((amount, i) => `
                                <div class="flex items-center justify-between p-4 rounded-lg bg-ink-800/30 border border-ink-700/50">
                                    <div class="flex items-center gap-3">
                                        <div class="w-8 h-8 rounded-full bg-ink-700 flex items-center justify-center text-sm font-mono text-ink-300">${i + 1}</div>
                                        <div>
                                            <div class="font-medium">${listing.milestoneTitles[i]}</div>
                                            <div class="text-sm text-ink-400">Milestone ${i + 1} of ${listing.milestoneAmounts.length}</div>
                                        </div>
                                    </div>
                                    <div class="text-right">
                                        <div class="font-mono font-semibold">${formatAmount(amount)} ${listing.token}</div>
                                        <div class="text-xs text-ink-500">${((parseFloat(amount) / parseFloat(listing.totalAmount)) * 100).toFixed(0)}% of total</div>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                </div>
                <div class="space-y-6">
                    <div class="bg-ink-900 border border-ink-800 rounded-xl p-6 sticky top-24">
                        <div class="text-center mb-6">
                            <div class="text-3xl font-bold font-mono">${formatAmount(listing.totalAmount)}</div>
                            <div class="text-ink-400">${listing.token}</div>
                        </div>
                        <div class="space-y-3 mb-6">
                            <div class="flex justify-between text-sm">
                                <span class="text-ink-400">Seller Bond</span>
                                <span class="font-mono text-warning-400">${formatAmount(listing.bondAmount)} ${listing.token}</span>
                            </div>
                            <div class="flex justify-between text-sm">
                                <span class="text-ink-400">Arbiter Fee</span>
                                <span class="font-mono">0.5%</span>
                            </div>
                            <div class="flex justify-between text-sm pt-3 border-t border-ink-800">
                                <span class="text-ink-400">You Pay</span>
                                <span class="font-mono font-semibold">${formatAmount(listing.totalAmount)} ${listing.token}</span>
                            </div>
                        </div>
                        ${state.connected ? `
                            ${isSeller ? `
                                <div class="p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 text-center">
                                    <p class="text-sm text-warning-400">This is your listing</p>
                                </div>
                            ` : isArbiter ? `
                                <div class="p-4 rounded-lg bg-danger-500/10 border border-danger-500/30 text-center">
                                    <p class="text-sm text-danger-400">You are the arbiter for this listing</p>
                                    <p class="text-xs text-ink-400 mt-1">Arbiters cannot purchase listings they oversee</p>
                                </div>
                            ` : listing.status === 'Active' ? `
                                <button onclick="purchaseListing(${listing.id})" class="btn-press w-full py-3 rounded-lg bg-trust-600 hover:bg-trust-500 text-white font-semibold glow-trust">
                                    Purchase & Open Escrow
                                </button>
                                <p class="text-xs text-ink-500 text-center mt-3">This will open an escrow vault with milestone-based release</p>
                            ` : `
                                <div class="p-4 rounded-lg bg-ink-800 text-center">
                                    <p class="text-sm text-ink-400">This listing is no longer available</p>
                                </div>
                            `}
                        ` : `
                            <button onclick="toggleWalletModal()" class="btn-press w-full py-3 rounded-lg bg-ink-800 hover:bg-ink-700 text-white font-semibold">
                                Connect to Purchase
                            </button>
                        `}
                        <div class="mt-6 pt-6 border-t border-ink-800 space-y-3">
                            <div class="flex items-center gap-2 text-sm text-ink-400">
                                <svg class="w-4 h-4 text-success-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                                </svg>
                                CRE-verified escrow
                            </div>
                            <div class="flex items-center gap-2 text-sm text-ink-400">
                                <svg class="w-4 h-4 text-success-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"/>
                                </svg>
                                Bond-protected seller
                            </div>
                            <div class="flex items-center gap-2 text-sm text-ink-400">
                                <svg class="w-4 h-4 text-success-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"/>
                                </svg>
                                Independent arbiter
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;
}

function purchaseListing(id) {
    const listing = state.listings.find(l => l.id === id);
    if (!listing) return;
    
    const newTrade = {
        id: state.trades.length + 1,
        listingId: id,
        vault: '0x' + Math.random().toString(16).substr(2, 40),
        buyer: state.address,
        seller: listing.seller,
        arbiter: listing.arbiter,
        token: listing.token,
        totalAmount: listing.totalAmount,
        bondAmount: listing.bondAmount,
        milestones: listing.milestoneAmounts.map((amt, i) => ({
            index: i,
            title: listing.milestoneTitles[i],
            amount: amt,
            status: 'Pending',
            docHash: null
        })),
        status: 'Active',
        funded: false,
        bondDeposited: false,
        createdAt: Date.now()
    };
    
    state.trades.push(newTrade);
    listing.status = 'Sold';
    
    simulateTx(true, 'Escrow vault created. Proceed to fund the trade.');
    setTimeout(() => {
        state.currentTrade = newTrade;
        showPage('trade');
    }, 2500);
}

// ============================================
// CREATE LISTING PAGE
// ============================================
function renderCreateListing() {
    return `
        <div class="fade-in max-w-3xl mx-auto">
            <div class="mb-8">
                <h1 class="text-2xl font-bold tracking-tight">Create Listing</h1>
                <p class="text-ink-400 mt-1">List your service or asset with milestone-based escrow protection</p>
            </div>
            <div class="bg-ink-900 border border-ink-800 rounded-xl p-6 space-y-6">
                <div>
                    <label class="block text-sm font-medium mb-2">Payment Token</label>
                    <select id="listing-token" onchange="updateTokenLabel()" class="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500">
                        <option value="USDC">USDC — USD Coin</option>
                        <option value="USDT">USDT — Tether</option>
                        <option value="DAI">DAI — Dai Stablecoin</option>
                    </select>
                    <p class="text-xs text-ink-500 mt-1">Tier caps assume ~1:1 USD peg for stablecoins</p>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Seller Bond Amount</label>
                    <div class="relative">
                        <input type="number" id="listing-bond" placeholder="0.00" class="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 pr-16 text-ink-200 font-mono focus:outline-none focus:border-trust-500">
                        <span class="absolute right-4 top-1/2 -translate-y-1/2 text-ink-400 text-sm bond-token-label">USDC</span>
                    </div>
                    <p class="text-xs text-ink-500 mt-1">This bond is locked during the trade and returned upon completion. It can be slashed if you fail to deliver.</p>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Arbiter Address</label>
                    <input type="text" id="listing-arbiter" placeholder="0x..." oninput="validateArbiter()" class="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500">
                    <p class="text-xs text-ink-500 mt-1">Must be a different address from your wallet. The arbiter resolves disputes and can slash your bond.</p>
                    <div id="arbiter-warning" class="hidden mt-2 p-3 rounded-lg bg-danger-500/10 border border-danger-500/30 text-sm text-danger-400">
                        Arbiter cannot be the same as seller address
                    </div>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Description</label>
                    <textarea id="listing-description" rows="3" placeholder="Describe what you're offering..." class="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500 resize-none"></textarea>
                </div>
                <div>
                    <label class="block text-sm font-medium mb-2">Metadata URI (optional)</label>
                    <input type="text" id="listing-metadata" placeholder="ipfs://..." class="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500">
                </div>
                <div>
                    <div class="flex items-center justify-between mb-3">
                        <label class="text-sm font-medium">Milestones</label>
                        <button onclick="addMilestone()" class="text-sm text-trust-400 hover:text-trust-300 font-medium">+ Add Milestone</button>
                    </div>
                    <div id="milestones-container" class="space-y-3">
                        <div class="milestone-row flex gap-3 items-center">
                            <div class="flex-1">
                                <input type="text" placeholder="Milestone title" class="milestone-title w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500">
                            </div>
                            <div class="w-32">
                                <input type="number" placeholder="Amount" oninput="updateMilestoneTotal()" class="milestone-amount w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500">
                            </div>
                            <button onclick="removeMilestone(this)" class="p-3 text-ink-500 hover:text-danger-400">
                                <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                                </svg>
                            </button>
                        </div>
                    </div>
                    <div class="mt-3 p-3 rounded-lg bg-ink-800/50 border border-ink-700 flex justify-between items-center">
                        <span class="text-sm text-ink-400">Total Amount</span>
                        <span class="font-mono font-semibold" id="milestone-total">0.00 USDC</span>
                    </div>
                </div>
                <button onclick="createListing()" class="btn-press w-full py-4 rounded-lg bg-trust-600 hover:bg-trust-500 text-white font-semibold text-lg glow-trust">
                    Create Listing
                </button>
            </div>
        </div>
    `;
}

function updateTokenLabel() {
    const token = document.getElementById('listing-token').value;
    document.querySelector('.bond-token-label').textContent = token;
    updateMilestoneTotal();
}

function validateArbiter() {
    const arbiter = document.getElementById('listing-arbiter').value;
    const warning = document.getElementById('arbiter-warning');
    if (state.address && arbiter.toLowerCase() === state.address.toLowerCase()) {
        warning.classList.remove('hidden');
    } else {
        warning.classList.add('hidden');
    }
}

function addMilestone() {
    const container = document.getElementById('milestones-container');
    const row = document.createElement('div');
    row.className = 'milestone-row flex gap-3 items-center fade-in';
    row.innerHTML = `
        <div class="flex-1">
            <input type="text" placeholder="Milestone title" class="milestone-title w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500">
        </div>
        <div class="w-32">
            <input type="number" placeholder="Amount" oninput="updateMilestoneTotal()" class="milestone-amount w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 font-mono focus:outline-none focus:border-trust-500">
        </div>
        <button onclick="removeMilestone(this)" class="p-3 text-ink-500 hover:text-danger-400">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
            </svg>
        </button>
    `;
    container.appendChild(row);
}

function removeMilestone(btn) {
    const rows = document.querySelectorAll('.milestone-row');
    if (rows.length > 1) {
        btn.closest('.milestone-row').remove();
        updateMilestoneTotal();
    }
}

function updateMilestoneTotal() {
    const amounts = document.querySelectorAll('.milestone-amount');
    let total = 0;
    amounts.forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    const token = document.getElementById('listing-token')?.value || 'USDC';
    document.getElementById('milestone-total').textContent = `${formatAmount(total)} ${token}`;
}

function createListing() {
    const token = document.getElementById('listing-token').value;
    const bond = document.getElementById('listing-bond').value || '0';
    const arbiter = document.getElementById('listing-arbiter').value;
    const description = document.getElementById('listing-description').value;
    
    if (!arbiter || arbiter.length < 42) {
        showToast('Please enter a valid arbiter address', 'error');
        return;
    }
    
    if (state.address && arbiter.toLowerCase() === state.address.toLowerCase()) {
        showToast('Arbiter cannot be the same as seller', 'error');
        return;
    }
    
    const titles = Array.from(document.querySelectorAll('.milestone-title')).map(i => i.value);
    const amounts = Array.from(document.querySelectorAll('.milestone-amount')).map(i => i.value);
    
    if (titles.some(t => !t) || amounts.some(a => !a)) {
        showToast('Please fill in all milestone fields', 'error');
        return;
    }
    
    const newListing = {
        id: state.listings.length + 1,
        seller: state.address || '0x0000000000000000000000000000000000000000',
        arbiter: arbiter,
        token: token,
        tokenAddress: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
        bondAmount: bond,
        totalAmount: amounts.reduce((a, b) => parseFloat(a) + parseFloat(b), 0).toString(),
        milestoneAmounts: amounts,
        milestoneTitles: titles,
        status: 'Active',
        createdAt: Date.now(),
        description: description || 'New listing'
    };
    
    state.listings.push(newListing);
    simulateTx(true, 'Listing created successfully');
    setTimeout(() => showPage('marketplace'), 2500);
}

// ============================================
// DASHBOARD PAGE
// ============================================
function renderDashboard() {
    const myTrades = state.trades.filter(t => 
        t.buyer.toLowerCase() === state.address?.toLowerCase() ||
        t.seller.toLowerCase() === state.address?.toLowerCase() ||
        t.arbiter.toLowerCase() === state.address?.toLowerCase()
    );

    return `
        <div class="fade-in">
            <div class="mb-8">
                <h1 class="text-2xl font-bold tracking-tight">My Trades</h1>
                <p class="text-ink-400 mt-1">Manage your active and completed escrow trades</p>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
                <div class="bg-ink-900 border border-ink-800 rounded-xl p-5">
                    <div class="text-sm text-ink-400 mb-1">Active Trades</div>
                    <div class="text-2xl font-bold font-mono">${myTrades.filter(t => t.status === 'Active').length}</div>
                </div>
                <div class="bg-ink-900 border border-ink-800 rounded-xl p-5">
                    <div class="text-sm text-ink-400 mb-1">Total Volume</div>
                    <div class="text-2xl font-bold font-mono">${formatAmount(myTrades.reduce((sum, t) => sum + parseFloat(t.totalAmount), 0))} USDC</div>
                </div>
                <div class="bg-ink-900 border border-ink-800 rounded-xl p-5">
                    <div class="text-sm text-ink-400 mb-1">Compliance Tier</div>
                    <div class="flex items-center gap-2">
                        <span class="text-2xl font-bold font-mono">Tier ${state.compliance.tier}</span>
                        ${VerificationBadge(state.compliance.tier, state.compliance.verified)}
                    </div>
                </div>
            </div>
            ${!state.compliance.verified ? `
                <div class="mb-8 p-4 rounded-xl bg-warning-500/10 border border-warning-500/30 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                    <div class="flex items-start gap-3">
                        <svg class="w-5 h-5 text-warning-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                        <div>
                            <h3 class="font-semibold text-warning-400">Identity Verification Required</h3>
                            <p class="text-sm text-ink-400 mt-1">Your current tier limits you to ${formatAmount(state.compliance.tier0Cap)} USDC per 30 days. Verify to increase your limit.</p>
                        </div>
                    </div>
                    <button onclick="showKYCModal()" class="btn-press px-4 py-2 rounded-lg bg-warning-600 hover:bg-warning-500 text-white text-sm font-semibold whitespace-nowrap">
                        Verify Identity
                    </button>
                </div>
            ` : ''}
            <div class="bg-ink-900 border border-ink-800 rounded-xl overflow-hidden">
                <div class="px-6 py-4 border-b border-ink-800">
                    <h2 class="font-semibold">All Trades</h2>
                </div>
                ${myTrades.length > 0 ? `
                    <div class="divide-y divide-ink-800">
                        ${myTrades.map(trade => renderTradeRow(trade)).join('')}
                    </div>
                ` : `
                    <div class="p-12 text-center">
                        <svg class="w-12 h-12 text-ink-600 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M20 13V6a2 2 0 00-2-2H6a2 2 0 00-2 2v7m16 0v5a2 2 0 01-2 2H6a2 2 0 01-2-2v-5m16 0h-2.586a1 1 0 00-.707.293l-2.414 2.414a1 1 0 01-.707.293h-3.172a1 1 0 01-.707-.293l-2.414-2.414A1 1 0 006.586 13H4"/>
                        </svg>
                        <h3 class="text-lg font-semibold mb-2">No trades yet</h3>
                        <p class="text-ink-400 mb-4">Start by browsing the marketplace or creating a listing</p>
                        <button onclick="showPage('marketplace')" class="btn-press px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold">
                            Browse Marketplace
                        </button>
                    </div>
                `}
            </div>
        </div>
    `;
}

function renderTradeRow(trade) {
    const role = state.address?.toLowerCase() === trade.buyer.toLowerCase() ? 'buyer' :
                 state.address?.toLowerCase() === trade.seller.toLowerCase() ? 'seller' :
                 state.address?.toLowerCase() === trade.arbiter.toLowerCase() ? 'arbiter' : 'viewer';
    const progress = trade.milestones.filter(m => m.status === 'Released').length / trade.milestones.length * 100;
    
    return `
        <div class="p-4 sm:p-6 hover:bg-ink-800/30 cursor-pointer transition-colors" onclick="viewTrade(${trade.id})">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-lg bg-ink-800 flex items-center justify-center">
                        <svg class="w-5 h-5 text-ink-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/>
                        </svg>
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-semibold">Trade #${trade.id}</span>
                            ${RoleBadge(role)}
                        </div>
                        <div class="text-sm text-ink-400 mt-1">
                            ${trade.milestones.length} milestones • ${formatAmount(trade.totalAmount)} ${trade.token}
                        </div>
                    </div>
                </div>
                <div class="flex items-center gap-4">
                    <div class="w-32">
                        <div class="flex justify-between text-xs mb-1">
                            <span class="text-ink-500">Progress</span>
                            <span class="text-ink-400">${progress.toFixed(0)}%</span>
                        </div>
                        <div class="h-2 bg-ink-800 rounded-full overflow-hidden">
                            <div class="h-full bg-trust-500 rounded-full" style="width: ${progress}%"></div>
                        </div>
                    </div>
                    ${StatusBadge(trade.milestones.some(m => m.status === 'Disputed') ? 'Disputed' : trade.funded ? 'Funded' : 'Pending')}
                </div>
            </div>
        </div>
    `;
}

function viewTrade(id) {
    state.currentTrade = state.trades.find(t => t.id === id);
    showPage('trade');
}

// ============================================
// TRADE DETAIL PAGE
// ============================================
function renderTradeDetail() {
    const trade = state.currentTrade || state.trades[0];
    const role = state.address?.toLowerCase() === trade.buyer.toLowerCase() ? 'buyer' :
                 state.address?.toLowerCase() === trade.seller.toLowerCase() ? 'seller' :
                 state.address?.toLowerCase() === trade.arbiter.toLowerCase() ? 'arbiter' : 'viewer';
    
    return `
        <div class="fade-in max-w-5xl mx-auto">
            <button onclick="showPage('dashboard')" class="flex items-center gap-2 text-ink-400 hover:text-white mb-6">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/>
                </svg>
                Back to Dashboard
            </button>
            
            <div class="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
                <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
                    <div>
                        <div class="flex items-center gap-3 mb-2">
                            <h1 class="text-2xl font-bold">Trade #${trade.id}</h1>
                            ${RoleBadge(role)}
                        </div>
                        <p class="text-ink-400">Escrow Vault: <span class="addr text-trust-400">${truncateAddress(trade.vault)}</span></p>
                    </div>
                    <div class="text-right">
                        <div class="text-2xl font-bold font-mono">${formatAmount(trade.totalAmount)} ${trade.token}</div>
                        <div class="text-sm text-ink-400">Total Value</div>
                    </div>
                </div>
                
                <div class="grid grid-cols-3 gap-4">
                    <div class="p-4 rounded-lg bg-ink-800/50 border border-ink-700 text-center">
                        <div class="text-xs text-ink-400 mb-1">Buyer</div>
                        <div class="addr text-ink-200">${truncateAddress(trade.buyer)}</div>
                        ${role === 'buyer' ? '<div class="text-xs text-trust-400 mt-1">You</div>' : ''}
                    </div>
                    <div class="p-4 rounded-lg bg-ink-800/50 border border-ink-700 text-center">
                        <div class="text-xs text-ink-400 mb-1">Seller</div>
                        <div class="addr text-ink-200">${truncateAddress(trade.seller)}</div>
                        ${role === 'seller' ? '<div class="text-xs text-success-400 mt-1">You</div>' : ''}
                    </div>
                    <div class="p-4 rounded-lg bg-ink-800/50 border border-ink-700 text-center">
                        <div class="text-xs text-ink-400 mb-1">Arbiter</div>
                        <div class="addr text-ink-200">${truncateAddress(trade.arbiter)}</div>
                        ${role === 'arbiter' ? '<div class="text-xs text-warning-400 mt-1">You</div>' : ''}
                    </div>
                </div>
            </div>

            ${!trade.funded ? renderFundingPanel(trade, role) : ''}
            ${trade.funded && !trade.bondDeposited && role === 'seller' ? renderBondPanel(trade) : ''}

            <div class="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
                <h2 class="font-semibold mb-6">Milestones</h2>
                <div class="space-y-4">
                    ${trade.milestones.map((milestone, i) => renderMilestone(trade, milestone, i, role)).join('')}
                </div>
            </div>

            ${role === 'arbiter' ? renderArbiterPanel(trade) : ''}
        </div>
    `;
}

function renderFundingPanel(trade, role) {
    const projectedVolume = state.compliance.currentVolume + parseFloat(trade.totalAmount);
    const cap = state.compliance.tier === 0 ? state.compliance.tier0Cap : state.compliance.tier1Cap;
    const wouldExceed = projectedVolume > cap;
    
    return `
        <div class="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
            <h2 class="font-semibold mb-4">Funding Required</h2>
            <div class="p-4 rounded-lg bg-trust-500/10 border border-trust-500/30 mb-4">
                <div class="flex items-center justify-between mb-2">
                    <span class="text-sm text-ink-300">Amount to fund</span>
                    <span class="font-mono font-semibold">${formatAmount(trade.totalAmount)} ${trade.token}</span>
                </div>
                <div class="flex items-center justify-between text-sm">
                    <span class="text-ink-400">Your 30-day volume</span>
                    <span class="font-mono">${formatAmount(state.compliance.currentVolume)} / ${formatAmount(cap)} ${trade.token}</span>
                </div>
            </div>
            ${wouldExceed ? `
                <div class="p-4 rounded-lg bg-danger-500/10 border border-danger-500/30 mb-4">
                    <div class="flex items-start gap-3">
                        <svg class="w-5 h-5 text-danger-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                        <div>
                            <h4 class="font-semibold text-danger-400">Compliance Limit Exceeded</h4>
                            <p class="text-sm text-ink-400 mt-1">
                                This trade would bring your 30-day volume to ${formatAmount(projectedVolume)} ${trade.token}, 
                                exceeding your Tier ${state.compliance.tier} limit of ${formatAmount(cap)} ${trade.token}.
                            </p>
                            <button onclick="showKYCModal()" class="mt-3 px-4 py-2 rounded-lg bg-warning-600 hover:bg-warning-500 text-white text-sm font-semibold">
                                Verify to Increase Limit
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
            ${role === 'buyer' ? `
                <button onclick="fundTrade(${trade.id})" ${wouldExceed ? 'disabled' : ''} class="btn-press w-full py-3 rounded-lg ${wouldExceed ? 'bg-ink-700 cursor-not-allowed' : 'bg-trust-600 hover:bg-trust-500 glow-trust'} text-white font-semibold transition-colors">
                    ${wouldExceed ? 'Compliance Limit Exceeded' : `Fund ${formatAmount(trade.totalAmount)} ${trade.token}`}
                </button>
            ` : `
                <div class="p-4 rounded-lg bg-ink-800 text-center">
                    <p class="text-sm text-ink-400">Waiting for buyer to fund the trade</p>
                </div>
            `}
        </div>
    `;
}

function renderBondPanel(trade) {
    return `
        <div class="bg-ink-900 border border-ink-800 rounded-xl p-6 mb-6">
            <h2 class="font-semibold mb-4">Deposit Seller Bond</h2>
            <div class="p-4 rounded-lg bg-warning-500/10 border border-warning-500/30 mb-4">
                <div class="flex items-center justify-between">
                    <span class="text-sm text-ink-300">Bond amount</span>
                    <span class="font-mono font-semibold text-warning-400">${formatAmount(trade.bondAmount)} ${trade.token}</span>
                </div>
            </div>
            <button onclick="depositBond(${trade.id})" class="btn-press w-full py-3 rounded-lg bg-warning-600 hover:bg-warning-500 text-white font-semibold">
                Deposit Bond
            </button>
        </div>
    `;
}

function renderMilestone(trade, milestone, index, role) {
    const canSubmitDocs = role === 'seller' && milestone.status === 'Pending' && trade.funded && trade.bondDeposited;
    const canConfirm = role === 'buyer' && milestone.status === 'DocsSubmitted';
    const canDispute = (role === 'buyer' || role === 'seller') && (milestone.status === 'Pending' || milestone.status === 'DocsSubmitted');
    
    return `
        <div class="border border-ink-700 rounded-xl p-5 ${milestone.status === 'Disputed' ? 'bg-danger-500/5 border-danger-500/30' : 'bg-ink-800/30'}">
            <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
                <div class="flex items-center gap-4">
                    <div class="w-10 h-10 rounded-full ${milestone.status === 'Released' ? 'bg-success-500/20' : milestone.status === 'Disputed' ? 'bg-danger-500/20' : 'bg-ink-700'} flex items-center justify-center">
                        ${milestone.status === 'Released' ? `
                            <svg class="w-5 h-5 text-success-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/>
                            </svg>
                        ` : `
                            <span class="font-mono text-sm ${milestone.status === 'Disputed' ? 'text-danger-400' : 'text-ink-300'}">${index + 1}</span>
                        `}
                    </div>
                    <div>
                        <div class="flex items-center gap-2">
                            <span class="font-semibold">${milestone.title}</span>
                            ${StatusBadge(milestone.status)}
                        </div>
                        <div class="text-sm text-ink-400 mt-1">${formatAmount(milestone.amount)} ${trade.token}</div>
                    </div>
                </div>
                ${milestone.docHash ? `
                    <div class="text-right">
                        <div class="text-xs text-ink-500 mb-1">Documentation</div>
                        <div class="addr text-trust-400">${truncateAddress(milestone.docHash, 8, 6)}</div>
                    </div>
                ` : ''}
            </div>
            
            ${milestone.status === 'Disputed' ? `
                <div class="p-4 rounded-lg bg-danger-500/10 border border-danger-500/30 mb-4">
                    <div class="flex items-start gap-3">
                        <svg class="w-5 h-5 text-danger-400 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                        </svg>
                        <div>
                            <div class="flex items-center gap-2 mb-1">
                                <span class="text-sm font-semibold text-danger-400">Disputed by ${truncateAddress(milestone.disputedBy)}</span>
                                <span class="text-xs text-ink-500">${timeAgo(milestone.disputedAt)}</span>
                            </div>
                            <p class="text-sm text-ink-300">${milestone.disputeReason}</p>
                        </div>
                    </div>
                </div>
            ` : ''}
            
            <div class="flex flex-wrap gap-2">
                ${canSubmitDocs ? `
                    <button onclick="showSubmitDocsModal(${trade.id}, ${index})" class="btn-press px-4 py-2 rounded-lg bg-trust-600 hover:bg-trust-500 text-white text-sm font-semibold">
                        Submit Documentation
                    </button>
                ` : ''}
                ${canConfirm ? `
                    <button onclick="confirmMilestone(${trade.id}, ${index})" class="btn-press px-4 py-2 rounded-lg bg-success-600 hover:bg-success-500 text-white text-sm font-semibold">
                        Confirm Delivery
                    </button>
                    <button onclick="checkDonConfirmation(${trade.id}, ${index})" class="btn-press px-4 py-2 rounded-lg bg-ink-700 hover:bg-ink-600 text-ink-300 text-sm font-medium">
                        Check DON Confirmation
                    </button>
                ` : ''}
                ${canDispute ? `
                    <button onclick="showDisputeModal(${trade.id}, ${index})" class="btn-press px-4 py-2 rounded-lg border border-danger-500/30 text-danger-400 hover:bg-danger-500/10 text-sm font-medium">
                        Raise Dispute
                    </button>
                ` : ''}
            </div>
        </div>
    `;
}

function renderArbiterPanel(trade) {
    const disputedMilestones = trade.milestones.filter(m => m.status === 'Disputed');
    
    return `
        <div class="bg-ink-900 border border-warning-500/30 rounded-xl p-6">
            <div class="flex items-center gap-3 mb-4">
                <div class="w-10 h-10 rounded-lg bg-warning-500/20 flex items-center justify-center">
                    <svg class="w-5 h-5 text-warning-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M3 6l3 1m0 0l-3 9a5.002 5.002 0 006.001 0M6 7l3 9M6 7l6-2m6 2l3-1m-3 1l-3 9a5.002 5.002 0 006.001 0M18 7l3 9m-3-9l-6-2m0-2v2m0 16V5m0 16H9m3 0h3"/>
                    </svg>
                </div>
                <div>
                    <h2 class="font-semibold">Arbiter Panel</h2>
                    <p class="text-sm text-ink-400">You have arbiter privileges on this trade</p>
                </div>
            </div>
            
            ${disputedMilestones.length > 0 ? `
                <div class="space-y-4">
                    ${disputedMilestones.map(m => `
                        <div class="p-4 rounded-lg bg-danger-500/5 border border-danger-500/20">
                            <div class="flex items-center justify-between mb-3">
                                <span class="font-semibold">${m.title}</span>
                                <span class="font-mono text-warning-400">${formatAmount(m.amount)} ${trade.token}</span>
                            </div>
                            <p class="text-sm text-ink-300 mb-4">${m.disputeReason}</p>
                            <div class="flex gap-2">
                                <button onclick="resolveDispute(${trade.id}, ${m.index}, true)" class="btn-press flex-1 py-2 rounded-lg bg-success-600 hover:bg-success-500 text-white text-sm font-semibold">
                                    Release to Seller
                                </button>
                                <button onclick="resolveDispute(${trade.id}, ${m.index}, false)" class="btn-press flex-1 py-2 rounded-lg bg-danger-600 hover:bg-danger-500 text-white text-sm font-semibold">
                                    Refund Buyer
                                </button>
                            </div>
                        </div>
                    `).join('')}
                </div>
            ` : `
                <div class="p-4 rounded-lg bg-ink-800 text-center">
                    <p class="text-sm text-ink-400">No active disputes on this trade</p>
                </div>
            `}
            
            ${trade.bondDeposited && trade.milestones.some(m => m.status === 'Refunded') ? `
                <div class="mt-4 pt-4 border-t border-ink-800">
                    <h3 class="text-sm font-semibold mb-3 text-warning-400">Bond Actions</h3>
                    <button onclick="slashBond(${trade.id})" class="btn-press w-full py-2 rounded-lg border border-warning-500/30 text-warning-400 hover:bg-warning-500/10 text-sm font-medium">
                        Slash Seller Bond (${formatAmount(trade.bondAmount)} ${trade.token})
                    </button>
                    <p class="text-xs text-ink-500 mt-2">Bond slashing is separate from dispute resolution. Use this if the seller failed to deliver and should forfeit their bond.</p>
                </div>
            ` : ''}
        </div>
    `;
}

// ============================================
// TRADE ACTIONS
// ============================================
function fundTrade(tradeId) {
    const trade = state.trades.find(t => t.id === tradeId);
    if (!trade) return;
    
    simulateTx(true, `Funded ${formatAmount(trade.totalAmount)} ${trade.token}`);
    setTimeout(() => {
        trade.funded = true;
        state.compliance.currentVolume += parseFloat(trade.totalAmount);
        renderPage();
    }, 2500);
}

function depositBond(tradeId) {
    const trade = state.trades.find(t => t.id === tradeId);
    if (!trade) return;
    
    simulateTx(true, `Deposited bond of ${formatAmount(trade.bondAmount)} ${trade.token}`);
    setTimeout(() => {
        trade.bondDeposited = true;
        renderPage();
    }, 2500);
}

function confirmMilestone(tradeId, milestoneIndex) {
    const trade = state.trades.find(t => t.id === tradeId);
    if (!trade) return;
    
    const milestone = trade.milestones[milestoneIndex];
    simulateTx(true, `Milestone "${milestone.title}" confirmed. ${formatAmount(milestone.amount)} ${trade.token} released to seller.`);
    setTimeout(() => {
        milestone.status = 'Released';
        milestone.confirmedAt = Date.now();
        
        // Check if all milestones released
        if (trade.milestones.every(m => m.status === 'Released')) {
            trade.status = 'Completed';
            showToast('All milestones completed! Bond returned to seller.', 'success');
        }
        renderPage();
    }, 2500);
}

function checkDonConfirmation(tradeId, milestoneIndex) {
    showToast('Checking DON confirmation...', 'info');
    setTimeout(() => {
        showToast('No DON confirmation found. This path requires a live escrow-confirmation workflow.', 'warning');
    }, 1500);
}

// ============================================
// MODALS
// ============================================
function showSubmitDocsModal(tradeId, milestoneIndex) {
    const trade = state.trades.find(t => t.id === tradeId);
    const milestone = trade.milestones[milestoneIndex];
    
    const modal = document.createElement('div');
    modal.id = 'docs-modal';
    modal.className = 'fixed inset-0 z-[100]';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black/60 modal-backdrop" onclick="closeModal('docs-modal')"></div>
        <div class="absolute inset-0 flex items-center justify-center p-4">
            <div class="bg-ink-900 border border-ink-700 rounded-2xl w-full max-w-md fade-in">
                <div class="p-6 border-b border-ink-800">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-semibold">Submit Documentation</h3>
                        <button onclick="closeModal('docs-modal')" class="text-ink-400 hover:text-white">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                    <p class="text-sm text-ink-400 mt-1">Milestone: ${milestone.title}</p>
                </div>
                <div class="p-6 space-y-4">
                    <div>
                        <label class="block text-sm font-medium mb-2">Proof of Completion</label>
                        <textarea id="docs-content" rows="4" placeholder="Enter proof text, reference URLs, or delivery confirmation..." class="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-trust-500 resize-none"></textarea>
                        <p class="text-xs text-ink-500 mt-1">This will be hashed and stored on-chain as proof of delivery</p>
                    </div>
                    <button onclick="submitDocs(${tradeId}, ${milestoneIndex})" class="btn-press w-full py-3 rounded-lg bg-trust-600 hover:bg-trust-500 text-white font-semibold">
                        Submit & Hash
                    </button>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function submitDocs(tradeId, milestoneIndex) {
    const content = document.getElementById('docs-content').value;
    if (!content) {
        showToast('Please enter proof content', 'error');
        return;
    }
    
    // Simulate keccak256 hash
    const mockHash = '0x' + Array.from({length: 64}, () => Math.floor(Math.random() * 16).toString(16)).join('');
    
    closeModal('docs-modal');
    simulateTx(true, 'Documentation submitted on-chain');
    
    setTimeout(() => {
        const trade = state.trades.find(t => t.id === tradeId);
        trade.milestones[milestoneIndex].status = 'DocsSubmitted';
        trade.milestones[milestoneIndex].docHash = mockHash;
        trade.milestones[milestoneIndex].submittedAt = Date.now();
        renderPage();
    }, 2500);
}

function showDisputeModal(tradeId, milestoneIndex) {
    const trade = state.trades.find(t => t.id === tradeId);
    const milestone = trade.milestones[milestoneIndex];
    
    const modal = document.createElement('div');
    modal.id = 'dispute-modal';
    modal.className = 'fixed inset-0 z-[100]';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black/60 modal-backdrop" onclick="closeModal('dispute-modal')"></div>
        <div class="absolute inset-0 flex items-center justify-center p-4">
            <div class="bg-ink-900 border border-danger-500/30 rounded-2xl w-full max-w-md fade-in">
                <div class="p-6 border-b border-danger-500/20">
                    <div class="flex items-center justify-between">
                        <div class="flex items-center gap-3">
                            <div class="w-10 h-10 rounded-full bg-danger-500/20 flex items-center justify-center">
                                <svg class="w-5 h-5 text-danger-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
                                </svg>
                            </div>
                            <div>
                                <h3 class="text-lg font-semibold text-danger-400">Raise Dispute</h3>
                                <p class="text-sm text-ink-400">Milestone: ${milestone.title}</p>
                            </div>
                        </div>
                        <button onclick="closeModal('dispute-modal')" class="text-ink-400 hover:text-white">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>
                <div class="p-6 space-y-4">
                    <div class="p-4 rounded-lg bg-danger-500/5 border border-danger-500/20">
                        <p class="text-sm text-ink-300">Raising a dispute will pause this milestone and require arbiter intervention. This action cannot be undone.</p>
                    </div>
                    <div>
                        <label class="block text-sm font-medium mb-2">Reason for Dispute</label>
                        <textarea id="dispute-reason" rows="4" placeholder="Explain why you're disputing this milestone..." class="w-full bg-ink-800 border border-ink-700 rounded-lg px-4 py-3 text-ink-200 focus:outline-none focus:border-danger-500 resize-none"></textarea>
                    </div>
                    <div class="flex gap-3">
                        <button onclick="closeModal('dispute-modal')" class="btn-press flex-1 py-3 rounded-lg bg-ink-800 hover:bg-ink-700 text-white font-semibold">
                            Cancel
                        </button>
                        <button onclick="submitDispute(${tradeId}, ${milestoneIndex})" class="btn-press flex-1 py-3 rounded-lg bg-danger-600 hover:bg-danger-500 text-white font-semibold">
                            Confirm Dispute
                        </button>
                    </div>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function submitDispute(tradeId, milestoneIndex) {
    const reason = document.getElementById('dispute-reason').value;
    if (!reason) {
        showToast('Please enter a reason for the dispute', 'error');
        return;
    }
    
    closeModal('dispute-modal');
    simulateTx(true, 'Dispute raised. Arbiter has been notified.');
    
    setTimeout(() => {
        const trade = state.trades.find(t => t.id === tradeId);
        const milestone = trade.milestones[milestoneIndex];
        milestone.status = 'Disputed';
        milestone.disputeReason = reason;
        milestone.disputedBy = state.address;
        milestone.disputedAt = Date.now();
        renderPage();
    }, 2500);
}

function resolveDispute(tradeId, milestoneIndex, releaseToSeller) {
    const trade = state.trades.find(t => t.id === tradeId);
    const milestone = trade.milestones[milestoneIndex];
    
    const action = releaseToSeller ? 'Release to Seller' : 'Refund Buyer';
    const amount = formatAmount(milestone.amount);
    
    if (!confirm(`Are you sure you want to ${action.toLowerCase()} for milestone "${milestone.title}"?\n\nAmount: ${amount} ${trade.token}\n\nThis action is irreversible.`)) {
        return;
    }
    
    simulateTx(true, `Dispute resolved: ${action}. ${amount} ${trade.token} ${releaseToSeller ? 'released to seller' : 'refunded to buyer'}.`);
    
    setTimeout(() => {
        milestone.status = releaseToSeller ? 'Released' : 'Refunded';
        milestone.resolvedAt = Date.now();
        renderPage();
    }, 2500);
}

function slashBond(tradeId) {
    const trade = state.trades.find(t => t.id === tradeId);
    
    if (!confirm(`Are you sure you want to slash the seller's bond?\n\nBond Amount: ${formatAmount(trade.bondAmount)} ${trade.token}\n\nThis is a separate action from dispute resolution and cannot be undone.`)) {
        return;
    }
    
    simulateTx(true, `Bond of ${formatAmount(trade.bondAmount)} ${trade.token} slashed.`);
    
    setTimeout(() => {
        trade.bondDeposited = false;
        trade.bondSlashed = true;
        renderPage();
    }, 2500);
}

function showKYCModal() {
    const modal = document.createElement('div');
    modal.id = 'kyc-modal';
    modal.className = 'fixed inset-0 z-[100]';
    modal.innerHTML = `
        <div class="absolute inset-0 bg-black/60 modal-backdrop" onclick="closeModal('kyc-modal')"></div>
        <div class="absolute inset-0 flex items-center justify-center p-4">
            <div class="bg-ink-900 border border-ink-700 rounded-2xl w-full max-w-md fade-in">
                <div class="p-6 border-b border-ink-800">
                    <div class="flex items-center justify-between">
                        <h3 class="text-lg font-semibold">Identity Verification</h3>
                        <button onclick="closeModal('kyc-modal')" class="text-ink-400 hover:text-white">
                            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/></svg>
                        </button>
                    </div>
                </div>
                <div class="p-6 space-y-6">
                    <!-- Tier Info -->
                    <div class="space-y-3">
                        <div class="p-4 rounded-lg bg-ink-800/50 border border-ink-700">
                            <div class="flex items-center justify-between mb-2">
                                <span class="font-semibold">Tier 0</span>
                                <span class="text-sm text-ink-400">Current</span>
                            </div>
                            <div class="text-sm text-ink-400">Limit: ${formatAmount(state.compliance.tier0Cap)} USDC / 30 days</div>
                        </div>
                        <div class="p-4 rounded-lg bg-trust-500/10 border border-trust-500/30">
                            <div class="flex items-center justify-between mb-2">
                                <span class="font-semibold text-trust-400">Tier 1</span>
                                <span class="text-sm text-trust-400">Target</span>
                            </div>
                            <div class="text-sm text-ink-400">Limit: ${formatAmount(state.compliance.tier1Cap)} USDC / 30 days</div>
                        </div>
                    </div>
                    
                    <!-- Mock KYC Flow -->
                    <div class="text-center py-4">
                        <div class="w-16 h-16 mx-auto mb-4 rounded-full bg-trust-500/20 flex items-center justify-center">
                            <svg class="w-8 h-8 text-trust-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/>
                            </svg>
                        </div>
                        <h4 class="font-semibold mb-2">Simulated Verification</h4>
                        <p class="text-sm text-ink-400 mb-4">This is a demonstration of the KYC flow. In production, this would connect to a compliance provider via Chainlink CRE.</p>
                        <div class="p-3 rounded-lg bg-ink-800 text-left">
                            <div class="text-xs text-ink-500 mb-1">Payload sent to CRE workflow:</div>
                            <pre class="text-xs font-mono text-trust-400">{\n  "subject": "${truncateAddress(state.address || '0x...')}",\n  "caseId": "kyc-${Date.now()}"\n}</pre>
                        </div>
                    </div>
                    
                    <button onclick="completeKYC()" class="btn-press w-full py-3 rounded-lg bg-trust-600 hover:bg-trust-500 text-white font-semibold">
                        Simulate Verification
                    </button>
                    
                    <p class="text-xs text-ink-500 text-center">Your personal data never touches the blockchain. Verification happens in a secure enclave.</p>
                </div>
            </div>
        </div>
    `;
    document.body.appendChild(modal);
}

function completeKYC() {
    closeModal('kyc-modal');
    
    // Show loading
    showTxModal('loading');
    
    setTimeout(() => {
        state.compliance.verified = true;
        state.compliance.tier = 1;
        showTxModal('success', 'Identity verified! Your tier has been increased to Tier 1.');
        setTimeout(() => {
            closeTxModal();
            renderPage();
        }, 2000);
    }, 2000);
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (modal) modal.remove();
}

// ============================================
// INITIALIZATION
// ============================================
document.addEventListener('DOMContentLoaded', () => {
    renderPage();
});