/** 内置示例：航天器双母线供电系统（含共享子门，演示吸收与归属）。 */
import type { FaultTreeInputs } from './types';

export const SAMPLE: FaultTreeInputs = {
  eventsText: `# 每行一个或多个基本事件（ASCII 标识），# 后为注释
BAT1_CELL_OPEN
BAT2_CELL_OPEN
BATT_BUS_BAR     # 电池组汇流条断裂
PCU1_REG_FAIL
PCU2_REG_FAIL
DIODE1_OPEN
DIODE2_OPEN
MAIN_BUS_SHORT
RELAY_STUCK_OPEN
WIRING_HARNESS_OPEN`,
  gatesText: `# 格式：门ID = AND(输入, ...) 或 门ID: OR 输入 ...
# 共享子门：被多个父门引用，只计算一次
G_BAT1_LOST = AND(BAT1_CELL_OPEN, DIODE1_OPEN)
G_BAT2_LOST = AND(BAT2_CELL_OPEN, DIODE2_OPEN)
G_BATT_BANK = AND(G_BAT1_LOST, G_BAT2_LOST)
G_PCU_RAIL  = AND(PCU1_REG_FAIL, PCU2_REG_FAIL)
G_BUS_TIE   = OR(MAIN_BUS_SHORT, RELAY_STUCK_OPEN, WIRING_HARNESS_OPEN)
# 吸收律演示：AND(G_BAT1_LOST, G_BAT1_LOST) 与 G_BAT1_LOST 等价；
# TOP 的电池支路中 {G_BAT1_LOST, G_BAT1_LOST 等} 真超集会被消去
G_REDUNDANT = AND(G_BAT1_LOST, G_BAT1_LOST, BATT_BUS_BAR)
TOP = OR(G_BATT_BANK, G_PCU_RAIL, G_BUS_TIE, G_REDUNDANT, BATT_BUS_BAR)`,
  topText: 'TOP',
};

export const EMPTY_INPUT: FaultTreeInputs = {
  eventsText: '',
  gatesText: '',
  topText: '',
};
