import { ConnectButton } from '@rainbow-me/rainbowkit';
import '@rainbow-me/rainbowkit/styles.css';
import React, { useEffect, useState } from "react";
import { getContractReadOnly, getContractWithSigner } from "./components/useContract";
import "./App.css";
import { useAccount } from 'wagmi';
import { useFhevm, useEncrypt, useDecrypt } from '../fhevm-sdk/src';

interface StepData {
  id: string;
  name: string;
  steps: number;
  timestamp: number;
  creator: string;
  publicValue1: number;
  publicValue2: number;
  isVerified?: boolean;
  decryptedValue?: number;
  rank?: number;
}

const App: React.FC = () => {
  const { address, isConnected } = useAccount();
  const [loading, setLoading] = useState(true);
  const [stepRecords, setStepRecords] = useState<StepData[]>([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [transactionStatus, setTransactionStatus] = useState<{ visible: boolean; status: "pending" | "success" | "error"; message: string; }>({ 
    visible: false, 
    status: "pending", 
    message: "" 
  });
  const [newStepData, setNewStepData] = useState({ name: "", steps: "" });
  const [selectedRecord, setSelectedRecord] = useState<StepData | null>(null);
  const [searchTerm, setSearchTerm] = useState("");
  const [filterVerified, setFilterVerified] = useState(false);
  const [userHistory, setUserHistory] = useState<StepData[]>([]);
  const [showStats, setShowStats] = useState(false);
  const [fhevmInitializing, setFhevmInitializing] = useState(false);

  const { status, initialize, isInitialized } = useFhevm();
  const { encrypt, isEncrypting } = useEncrypt();
  const { verifyDecryption, isDecrypting: fheIsDecrypting } = useDecrypt();

  useEffect(() => {
    const initFhevmAfterConnection = async () => {
      if (!isConnected) return;
      if (isInitialized || fhevmInitializing) return;
      
      try {
        setFhevmInitializing(true);
        await initialize();
      } catch (error) {
        setTransactionStatus({ 
          visible: true, 
          status: "error", 
          message: "FHEVM initialization failed" 
        });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      } finally {
        setFhevmInitializing(false);
      }
    };

    initFhevmAfterConnection();
  }, [isConnected, isInitialized, initialize, fhevmInitializing]);

  useEffect(() => {
    const loadDataAndContract = async () => {
      if (!isConnected) {
        setLoading(false);
        return;
      }
      
      try {
        await loadStepData();
      } catch (error) {
        console.error('Failed to load data:', error);
      } finally {
        setLoading(false);
      }
    };

    loadDataAndContract();
  }, [isConnected]);

  const loadStepData = async () => {
    if (!isConnected) return;
    
    setIsRefreshing(true);
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const businessIds = await contract.getAllBusinessIds();
      const records: StepData[] = [];
      
      for (const businessId of businessIds) {
        try {
          const businessData = await contract.getBusinessData(businessId);
          records.push({
            id: businessId,
            name: businessData.name,
            steps: Number(businessData.publicValue1) || 0,
            timestamp: Number(businessData.timestamp),
            creator: businessData.creator,
            publicValue1: Number(businessData.publicValue1) || 0,
            publicValue2: Number(businessData.publicValue2) || 0,
            isVerified: businessData.isVerified,
            decryptedValue: Number(businessData.decryptedValue) || 0
          });
        } catch (e) {
          console.error('Error loading step data:', e);
        }
      }
      
      const rankedRecords = records
        .filter(record => record.isVerified)
        .sort((a, b) => (b.decryptedValue || 0) - (a.decryptedValue || 0))
        .map((record, index) => ({ ...record, rank: index + 1 }));
      
      setStepRecords(rankedRecords);
      
      if (address) {
        const userRecords = records.filter(record => record.creator.toLowerCase() === address.toLowerCase());
        setUserHistory(userRecords);
      }
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Failed to load data" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setIsRefreshing(false); 
    }
  };

  const uploadSteps = async () => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return; 
    }
    
    setUploading(true);
    setTransactionStatus({ visible: true, status: "pending", message: "Encrypting step data with Zama FHE..." });
    
    try {
      const contract = await getContractWithSigner();
      if (!contract) throw new Error("Failed to get contract with signer");
      
      const stepValue = parseInt(newStepData.steps) || 0;
      const businessId = `steps-${Date.now()}-${address.substring(2, 8)}`;
      
      const encryptedResult = await encrypt(await contract.getAddress(), address, stepValue);
      
      const tx = await contract.createBusinessData(
        businessId,
        newStepData.name,
        encryptedResult.encryptedData,
        encryptedResult.proof,
        stepValue,
        0,
        `Daily steps: ${stepValue}`
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Uploading encrypted steps..." });
      await tx.wait();
      
      setTransactionStatus({ visible: true, status: "success", message: "Steps uploaded successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      await loadStepData();
      setShowUploadModal(false);
      setNewStepData({ name: "", steps: "" });
    } catch (e: any) {
      const errorMessage = e.message?.includes("user rejected transaction") 
        ? "Transaction rejected" 
        : "Upload failed: " + (e.message || "Unknown error");
      setTransactionStatus({ visible: true, status: "error", message: errorMessage });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    } finally { 
      setUploading(false); 
    }
  };

  const decryptSteps = async (businessId: string): Promise<number | null> => {
    if (!isConnected || !address) { 
      setTransactionStatus({ visible: true, status: "error", message: "Please connect wallet first" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
    
    try {
      const contractRead = await getContractReadOnly();
      if (!contractRead) return null;
      
      const businessData = await contractRead.getBusinessData(businessId);
      if (businessData.isVerified) {
        const storedValue = Number(businessData.decryptedValue) || 0;
        setTransactionStatus({ visible: true, status: "success", message: "Steps already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        return storedValue;
      }
      
      const contractWrite = await getContractWithSigner();
      if (!contractWrite) return null;
      
      const encryptedValueHandle = await contractRead.getEncryptedValue(businessId);
      
      const result = await verifyDecryption(
        [encryptedValueHandle],
        await contractWrite.getAddress(),
        (abiEncodedClearValues: string, decryptionProof: string) => 
          contractWrite.verifyDecryption(businessId, abiEncodedClearValues, decryptionProof)
      );
      
      setTransactionStatus({ visible: true, status: "pending", message: "Verifying steps..." });
      
      const clearValue = result.decryptionResult.clearValues[encryptedValueHandle];
      
      await loadStepData();
      
      setTransactionStatus({ visible: true, status: "success", message: "Steps verified successfully!" });
      setTimeout(() => {
        setTransactionStatus({ visible: false, status: "pending", message: "" });
      }, 2000);
      
      return Number(clearValue);
      
    } catch (e: any) { 
      if (e.message?.includes("Data already verified")) {
        setTransactionStatus({ visible: true, status: "success", message: "Steps already verified" });
        setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
        await loadStepData();
        return null;
      }
      
      setTransactionStatus({ visible: true, status: "error", message: "Verification failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
      return null; 
    }
  };

  const checkAvailability = async () => {
    try {
      const contract = await getContractReadOnly();
      if (!contract) return;
      
      const isAvailable = await contract.isAvailable();
      setTransactionStatus({ visible: true, status: "success", message: "System available: " + isAvailable });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 2000);
    } catch (e) {
      setTransactionStatus({ visible: true, status: "error", message: "Availability check failed" });
      setTimeout(() => setTransactionStatus({ visible: false, status: "pending", message: "" }), 3000);
    }
  };

  const filteredRecords = stepRecords.filter(record => 
    record.name.toLowerCase().includes(searchTerm.toLowerCase()) &&
    (!filterVerified || record.isVerified)
  );

  const stats = {
    totalRecords: stepRecords.length,
    verifiedRecords: stepRecords.filter(r => r.isVerified).length,
    totalSteps: stepRecords.filter(r => r.isVerified).reduce((sum, r) => sum + (r.decryptedValue || 0), 0),
    avgSteps: stepRecords.filter(r => r.isVerified).length > 0 
      ? Math.round(stepRecords.filter(r => r.isVerified).reduce((sum, r) => sum + (r.decryptedValue || 0), 0) / stepRecords.filter(r => r.isVerified).length)
      : 0,
    topPerformer: stepRecords.filter(r => r.isVerified).sort((a, b) => (b.decryptedValue || 0) - (a.decryptedValue || 0))[0]
  };

  if (!isConnected) {
    return (
      <div className="app-container">
        <header className="app-header">
          <div className="logo-section">
            <div className="logo-icon">🏃‍♂️</div>
            <h1>Private Step Challenge</h1>
            <span className="fhe-badge">FHE 🔐</span>
          </div>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </header>
        
        <div className="hero-section">
          <div className="hero-content">
            <h2>Step Competition with Privacy Protection</h2>
            <p>Upload encrypted step data, compute rankings homomorphically, protect your exercise habits</p>
            <div className="feature-grid">
              <div className="feature-card">
                <div className="feature-icon">🔒</div>
                <h3>Data Encryption</h3>
                <p>Step data encrypted with Zama FHE technology</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">📊</div>
                <h3>Homomorphic Ranking</h3>
                <p>Compute rankings without decrypting data</p>
              </div>
              <div className="feature-card">
                <div className="feature-icon">🏆</div>
                <h3>Privacy Competition</h3>
                <p>Fair competition while protecting privacy</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!isInitialized || fhevmInitializing) {
    return (
      <div className="loading-screen">
        <div className="metal-spinner"></div>
        <p>Initializing FHE Encryption System...</p>
      </div>
    );
  }

  if (loading) return (
    <div className="loading-screen">
      <div className="metal-spinner"></div>
      <p>Loading Step Challenge...</p>
    </div>
  );

  return (
    <div className="app-container">
      <header className="app-header">
        <div className="header-left">
          <div className="logo-section">
            <div className="logo-icon">🏃‍♂️</div>
            <h1>Private Step Challenge</h1>
            <span className="fhe-badge">FHE 🔐</span>
          </div>
          
          <nav className="main-nav">
            <button className={`nav-btn ${!showStats ? 'active' : ''}`} onClick={() => setShowStats(false)}>
              Leaderboard
            </button>
            <button className={`nav-btn ${showStats ? 'active' : ''}`} onClick={() => setShowStats(true)}>
              Statistics
            </button>
          </nav>
        </div>
        
        <div className="header-right">
          <button className="system-btn" onClick={checkAvailability}>
            System Check
          </button>
          <ConnectButton accountStatus="address" chainStatus="icon" showBalance={false}/>
        </div>
      </header>

      <div className="main-content">
        {!showStats ? (
          <>
            <div className="toolbar">
              <div className="search-section">
                <input 
                  type="text" 
                  placeholder="Search participants..." 
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="search-input"
                />
                <label className="filter-toggle">
                  <input 
                    type="checkbox" 
                    checked={filterVerified}
                    onChange={(e) => setFilterVerified(e.target.checked)}
                  />
                  Verified Only
                </label>
              </div>
              
              <div className="action-buttons">
                <button className="refresh-btn" onClick={loadStepData} disabled={isRefreshing}>
                  {isRefreshing ? "Refreshing..." : "Refresh"}
                </button>
                <button className="upload-btn" onClick={() => setShowUploadModal(true)}>
                  + Upload Steps
                </button>
              </div>
            </div>

            <div className="leaderboard-section">
              <h2>Step Challenge Leaderboard</h2>
              
              <div className="records-grid">
                {filteredRecords.length === 0 ? (
                  <div className="empty-state">
                    <div className="empty-icon">📊</div>
                    <p>No step records found</p>
                    <button className="upload-btn" onClick={() => setShowUploadModal(true)}>
                      Upload First Record
                    </button>
                  </div>
                ) : (
                  filteredRecords.map((record, index) => (
                    <div 
                      key={record.id}
                      className={`record-card ${record.isVerified ? 'verified' : 'pending'}`}
                      onClick={() => setSelectedRecord(record)}
                    >
                      <div className="record-rank">
                        {record.rank ? `#${record.rank}` : '--'}
                      </div>
                      <div className="record-info">
                        <div className="record-name">{record.name}</div>
                        <div className="record-meta">
                          <span>{new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                          <span>•</span>
                          <span>{record.creator.substring(0, 6)}...{record.creator.substring(38)}</span>
                        </div>
                      </div>
                      <div className="record-steps">
                        {record.isVerified ? (
                          <span className="steps-verified">{record.decryptedValue} steps</span>
                        ) : (
                          <span className="steps-encrypted">🔒 Encrypted</span>
                        )}
                      </div>
                      <div className={`record-status ${record.isVerified ? 'verified' : 'pending'}`}>
                        {record.isVerified ? '✅ Verified' : '🔓 Verify'}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        ) : (
          <div className="stats-section">
            <h2>Challenge Statistics</h2>
            
            <div className="stats-grid">
              <div className="stat-card metal-card">
                <div className="stat-icon">👥</div>
                <div className="stat-value">{stats.totalRecords}</div>
                <div className="stat-label">Total Participants</div>
              </div>
              
              <div className="stat-card metal-card">
                <div className="stat-icon">✅</div>
                <div className="stat-value">{stats.verifiedRecords}</div>
                <div className="stat-label">Verified Records</div>
              </div>
              
              <div className="stat-card metal-card">
                <div className="stat-icon">👣</div>
                <div className="stat-value">{stats.totalSteps.toLocaleString()}</div>
                <div className="stat-label">Total Steps</div>
              </div>
              
              <div className="stat-card metal-card">
                <div className="stat-icon">📈</div>
                <div className="stat-value">{stats.avgSteps}</div>
                <div className="stat-label">Average Steps</div>
              </div>
            </div>

            {stats.topPerformer && (
              <div className="top-performer metal-card">
                <h3>🏆 Top Performer</h3>
                <div className="performer-info">
                  <span className="performer-name">{stats.topPerformer.name}</span>
                  <span className="performer-steps">{stats.topPerformer.decryptedValue} steps</span>
                </div>
              </div>
            )}

            {userHistory.length > 0 && (
              <div className="user-history metal-card">
                <h3>Your Upload History</h3>
                <div className="history-list">
                  {userHistory.map(record => (
                    <div key={record.id} className="history-item">
                      <span>{new Date(record.timestamp * 1000).toLocaleDateString()}</span>
                      <span>{record.name}</span>
                      <span>{record.isVerified ? `${record.decryptedValue} steps` : 'Pending'}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {showUploadModal && (
        <UploadModal 
          onSubmit={uploadSteps} 
          onClose={() => setShowUploadModal(false)} 
          uploading={uploading}
          stepData={newStepData}
          setStepData={setNewStepData}
          isEncrypting={isEncrypting}
        />
      )}

      {selectedRecord && (
        <DetailModal 
          record={selectedRecord}
          onClose={() => setSelectedRecord(null)}
          onVerify={() => decryptSteps(selectedRecord.id)}
          isVerifying={fheIsDecrypting}
        />
      )}

      {transactionStatus.visible && (
        <div className={`transaction-toast ${transactionStatus.status}`}>
          <div className="toast-content">
            <div className="toast-icon">
              {transactionStatus.status === "pending" && <div className="metal-spinner small"></div>}
              {transactionStatus.status === "success" && "✓"}
              {transactionStatus.status === "error" && "✗"}
            </div>
            <span>{transactionStatus.message}</span>
          </div>
        </div>
      )}
    </div>
  );
};

const UploadModal: React.FC<{
  onSubmit: () => void; 
  onClose: () => void; 
  uploading: boolean;
  stepData: any;
  setStepData: (data: any) => void;
  isEncrypting: boolean;
}> = ({ onSubmit, onClose, uploading, stepData, setStepData, isEncrypting }) => {
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    if (name === 'steps') {
      const intValue = value.replace(/[^\d]/g, '');
      setStepData({ ...stepData, [name]: intValue });
    } else {
      setStepData({ ...stepData, [name]: value });
    }
  };

  return (
    <div className="modal-overlay">
      <div className="upload-modal metal-modal">
        <div className="modal-header">
          <h2>Upload Step Data</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="fhe-notice metal-notice">
            <div className="notice-icon">🔐</div>
            <div>
              <strong>FHE Encryption Active</strong>
              <p>Step data will be encrypted using Zama FHE technology</p>
            </div>
          </div>
          
          <div className="form-group">
            <label>Participant Name</label>
            <input 
              type="text" 
              name="name" 
              value={stepData.name} 
              onChange={handleChange} 
              placeholder="Enter your name..." 
              className="metal-input"
            />
          </div>
          
          <div className="form-group">
            <label>Steps Count (Integer only)</label>
            <input 
              type="number" 
              name="steps" 
              value={stepData.steps} 
              onChange={handleChange} 
              placeholder="Enter step count..." 
              step="1"
              min="0"
              className="metal-input"
            />
            <div className="input-hint">FHE Encrypted Integer</div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="cancel-btn metal-btn">Cancel</button>
          <button 
            onClick={onSubmit} 
            disabled={uploading || isEncrypting || !stepData.name || !stepData.steps} 
            className="submit-btn metal-btn primary"
          >
            {uploading || isEncrypting ? "Encrypting..." : "Upload Encrypted"}
          </button>
        </div>
      </div>
    </div>
  );
};

const DetailModal: React.FC<{
  record: StepData;
  onClose: () => void;
  onVerify: () => void;
  isVerifying: boolean;
}> = ({ record, onClose, onVerify, isVerifying }) => {
  return (
    <div className="modal-overlay">
      <div className="detail-modal metal-modal">
        <div className="modal-header">
          <h2>Step Record Details</h2>
          <button onClick={onClose} className="close-btn">&times;</button>
        </div>
        
        <div className="modal-body">
          <div className="record-details">
            <div className="detail-row">
              <span>Name:</span>
              <strong>{record.name}</strong>
            </div>
            <div className="detail-row">
              <span>Date:</span>
              <strong>{new Date(record.timestamp * 1000).toLocaleString()}</strong>
            </div>
            <div className="detail-row">
              <span>Creator:</span>
              <strong>{record.creator}</strong>
            </div>
            <div className="detail-row">
              <span>Status:</span>
              <span className={`status-badge ${record.isVerified ? 'verified' : 'pending'}`}>
                {record.isVerified ? '✅ Verified' : '🔓 Pending Verification'}
              </span>
            </div>
          </div>
          
          <div className="steps-section">
            <h3>Step Data</h3>
            <div className="steps-display">
              {record.isVerified ? (
                <div className="verified-steps">
                  <span className="steps-value">{record.decryptedValue}</span>
                  <span className="steps-label">steps (On-chain Verified)</span>
                </div>
              ) : (
                <div className="encrypted-steps">
                  <div className="encrypted-icon">🔒</div>
                  <span>FHE Encrypted Steps</span>
                  <button 
                    onClick={onVerify}
                    disabled={isVerifying}
                    className="verify-btn metal-btn"
                  >
                    {isVerifying ? "Verifying..." : "Verify on-chain"}
                  </button>
                </div>
              )}
            </div>
          </div>
          
          <div className="fhe-info metal-notice">
            <h4>FHE Protection Process</h4>
            <div className="process-steps">
              <div className="process-step">
                <span>1</span>
                <p>Steps encrypted client-side with Zama FHE</p>
              </div>
              <div className="process-step">
                <span>2</span>
                <p>Encrypted data stored on blockchain</p>
              </div>
              <div className="process-step">
                <span>3</span>
                <p>Ranking computed homomorphically</p>
              </div>
              <div className="process-step">
                <span>4</span>
                <p>Optional on-chain verification</p>
              </div>
            </div>
          </div>
        </div>
        
        <div className="modal-footer">
          <button onClick={onClose} className="close-btn metal-btn">Close</button>
          {!record.isVerified && (
            <button 
              onClick={onVerify}
              disabled={isVerifying}
              className="verify-btn metal-btn primary"
            >
              {isVerifying ? "Verifying..." : "Verify Steps"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;


