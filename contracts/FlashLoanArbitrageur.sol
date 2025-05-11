// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter} from "@uniswap/v3-periphery/contracts/interfaces/ISwapRouter.sol";
import {IUniswapV3Pool} from "@uniswap/v3-core/contracts/interfaces/IUniswapV3Pool.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {IPool} from "@aave/core-v3/contracts/interfaces/IPool.sol";
import {IPoolAddressesProvider} from "@aave/core-v3/contracts/interfaces/IPoolAddressesProvider.sol";
using Strings for uint256;

interface IUniswapV3FlashCallback {
    function uniswapV3FlashCallback(uint256 fee0, uint256 fee1, bytes calldata data) external;
}

contract FlashLoanArbitrageur is IUniswapV3FlashCallback {
    struct ArbitrageParams {
        address token0;
        address token1;
        address tokenMid;
        uint24 fee1;
        uint24 fee2;
        uint256 minProfit;
        uint8 direction; // 0: token0->tokenMid->token1, 1: token1->tokenMid->token0
        address uniswapRouter;
        address sushiswapRouter;
        address initiator;
    }

    address public owner;
    event ArbitrageExecuted(address indexed initiator, address asset, uint256 profit);
    event Debug(string message);

    modifier onlyOwner() {
        require(msg.sender == owner, "Not owner");
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function startUniswapV3Flash(
        address pool,
        uint256 amount0,
        uint256 amount1,
        address tokenMid,
        uint24 fee1,
        uint24 fee2,
        uint256 minProfit,
        uint8 direction,
        address uniswapRouter,
        address sushiswapRouter
    ) external onlyOwner {
        ArbitrageParams memory arb = ArbitrageParams({
            token0: IUniswapV3Pool(pool).token0(),
            token1: IUniswapV3Pool(pool).token1(),
            tokenMid: tokenMid,
            fee1: fee1,
            fee2: fee2,
            minProfit: minProfit,
            direction: direction,
            uniswapRouter: uniswapRouter,
            sushiswapRouter: sushiswapRouter,
            initiator: msg.sender
        });
        bytes memory data = abi.encode(arb);
        IUniswapV3Pool(pool).flash(address(this), amount0, amount1, data);
    }

    // Callback Uniswap V3 flash loan
    function uniswapV3FlashCallback(
        uint256 fee0,
        uint256 fee1,
        bytes calldata data
    ) external override {
        emit Debug("Start uniswapV3FlashCallback");
        ArbitrageParams memory arb = abi.decode(data, (ArbitrageParams));
        address pool = msg.sender;
        uint256 amountOwed0 = fee0;
        uint256 amountOwed1 = fee1;
        // On récupère les soldes avant arbitrage
        uint256 bal0Before = IERC20(arb.token0).balanceOf(address(this));
        uint256 bal1Before = IERC20(arb.token1).balanceOf(address(this));

        // On déduit ce qu'on a reçu (flash loan)
        uint256 flashAmount = bal0Before > 0 ? bal0Before : bal1Before;
        emit Debug(string.concat("Received flash amount: ", flashAmount.toString()));

        // Arbitrage principal
        uint256 amountMid;
        uint256 amountBack;
        if (arb.direction == 0) {
            // token0 -> tokenMid -> token1
            amountMid = _swap(ISwapRouter(arb.uniswapRouter), arb.token0, arb.tokenMid, arb.fee1, flashAmount);
            amountBack = _swap(ISwapRouter(arb.sushiswapRouter), arb.tokenMid, arb.token1, arb.fee2, amountMid);
        } else {
            // token1 -> tokenMid -> token0
            amountMid = _swap(ISwapRouter(arb.uniswapRouter), arb.token1, arb.tokenMid, arb.fee1, flashAmount);
            amountBack = _swap(ISwapRouter(arb.sushiswapRouter), arb.tokenMid, arb.token0, arb.fee2, amountMid);
        }

        // Remboursement du principal + frais
        uint256 totalOwed0 = fee0 + (bal0Before > 0 ? bal0Before : 0);
        uint256 totalOwed1 = fee1 + (bal1Before > 0 ? bal1Before : 0);
        if (totalOwed0 > 0) {
            IERC20(arb.token0).transfer(pool, totalOwed0);
        }
        if (totalOwed1 > 0) {
            IERC20(arb.token1).transfer(pool, totalOwed1);
        }

        // Calcul du profit sur le token principal (token1 si direction 0, token0 sinon)
        uint256 profit = (arb.direction == 0)
            ? IERC20(arb.token1).balanceOf(address(this)) - bal1Before - fee1
            : IERC20(arb.token0).balanceOf(address(this)) - bal0Before - fee0;
        require(profit >= arb.minProfit, "Not enough profit");
        emit ArbitrageExecuted(arb.initiator, arb.direction == 0 ? arb.token1 : arb.token0, profit);
        emit Debug("Arbitrage finished successfully");
    }

    function _swap(
        ISwapRouter router,
        address tokenIn,
        address tokenOut,
        uint24 fee,
        uint256 amountIn
    ) internal returns (uint256) {
        IERC20(tokenIn).approve(address(router), amountIn);
        uint256 out;
        try router.exactInputSingle(
            ISwapRouter.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: fee,
                recipient: address(this),
                deadline: block.timestamp,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
        ) returns (uint256 amtOut) {
            out = amtOut;
        } catch {
            emit Debug("Swap revert on router");
            revert("Swap failed");
        }
        emit Debug(string.concat("Swap out: ", out.toString()));
        return out;
    }

    function withdraw(address token) external onlyOwner {
        uint256 bal = IERC20(token).balanceOf(address(this));
        require(bal > 0, "Nothing to withdraw");
        IERC20(token).transfer(owner, bal);
    }
}

