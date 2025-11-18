pragma solidity ^0.8.24;

import { FHE, euint32, externalEuint32 } from "@fhevm/solidity/lib/FHE.sol";
import { ZamaEthereumConfig } from "@fhevm/solidity/config/ZamaConfig.sol";

contract StepCompAdapter is ZamaEthereumConfig {
    
    struct Participant {
        string nickname;                    
        euint32 encryptedSteps;        
        uint256 publicValue1;          
        uint256 publicValue2;          
        string description;            
        address creator;               
        uint256 timestamp;             
        uint32 decryptedSteps; 
        bool isVerified; 
    }
    

    mapping(string => Participant) public participants;
    
    string[] public participantIds;
    
    event ParticipantJoined(string indexed participantId, address indexed creator);
    event StepsVerified(string indexed participantId, uint32 decryptedSteps);
    
    constructor() ZamaEthereumConfig() {
    }
    
    function joinChallenge(
        string calldata participantId,
        string calldata nickname,
        externalEuint32 encryptedSteps,
        bytes calldata inputProof,
        uint256 publicValue1,
        uint256 publicValue2,
        string calldata description
    ) external {
        require(bytes(participants[participantId].nickname).length == 0, "Participant already exists");
        
        require(FHE.isInitialized(FHE.fromExternal(encryptedSteps, inputProof)), "Invalid encrypted input");
        
        participants[participantId] = Participant({
            nickname: nickname,
            encryptedSteps: FHE.fromExternal(encryptedSteps, inputProof),
            publicValue1: publicValue1,
            publicValue2: publicValue2,
            description: description,
            creator: msg.sender,
            timestamp: block.timestamp,
            decryptedSteps: 0,
            isVerified: false
        });
        
        FHE.allowThis(participants[participantId].encryptedSteps);
        
        FHE.makePubliclyDecryptable(participants[participantId].encryptedSteps);
        
        participantIds.push(participantId);
        
        emit ParticipantJoined(participantId, msg.sender);
    }
    
    function verifySteps(
        string calldata participantId, 
        bytes memory abiEncodedClearValue,
        bytes memory decryptionProof
    ) external {
        require(bytes(participants[participantId].nickname).length > 0, "Participant does not exist");
        require(!participants[participantId].isVerified, "Data already verified");
        
        bytes32[] memory cts = new bytes32[](1);
        cts[0] = FHE.toBytes32(participants[participantId].encryptedSteps);
        
        FHE.checkSignatures(cts, abiEncodedClearValue, decryptionProof);
        
        uint32 decodedValue = abi.decode(abiEncodedClearValue, (uint32));
        
        participants[participantId].decryptedSteps = decodedValue;
        participants[participantId].isVerified = true;
        
        emit StepsVerified(participantId, decodedValue);
    }
    
    function getEncryptedSteps(string calldata participantId) external view returns (euint32) {
        require(bytes(participants[participantId].nickname).length > 0, "Participant does not exist");
        return participants[participantId].encryptedSteps;
    }
    
    function getParticipantData(string calldata participantId) external view returns (
        string memory nickname,
        uint256 publicValue1,
        uint256 publicValue2,
        string memory description,
        address creator,
        uint256 timestamp,
        bool isVerified,
        uint32 decryptedSteps
    ) {
        require(bytes(participants[participantId].nickname).length > 0, "Participant does not exist");
        Participant storage data = participants[participantId];
        
        return (
            data.nickname,
            data.publicValue1,
            data.publicValue2,
            data.description,
            data.creator,
            data.timestamp,
            data.isVerified,
            data.decryptedSteps
        );
    }
    
    function getAllParticipantIds() external view returns (string[] memory) {
        return participantIds;
    }
    
    function isAvailable() public pure returns (bool) {
        return true;
    }
}


